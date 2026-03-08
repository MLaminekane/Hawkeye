/**
 * Claude Code Hook Handler
 *
 * Invoked by Claude Code hooks (PreToolUse, PostToolUse, Stop).
 * Reads JSON from stdin, evaluates guardrails, records events with full data
 * capture including Bash output, LLM cost estimation, and drift detection.
 *
 * Usage:
 *   hawkeye hook-handler --event PreToolUse   (stdin: JSON from Claude Code)
 *   hawkeye hook-handler --event PostToolUse  (stdin: JSON from Claude Code)
 *   hawkeye hook-handler --event Stop         (stdin: JSON from Claude Code)
 */

import { Command } from 'commander';
import { join, extname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Storage, scoreHeuristic, slidingDriftScore } from '@hawkeye/core';
import type { TraceEvent, EventType, DriftFlag } from '@hawkeye/core';

// ── Cost estimation ──
// Claude Code primarily uses Claude models. Default to sonnet pricing.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

function estimateTokens(text: string): number {
  // ~4 chars per token for English/code
  return Math.ceil((text?.length || 0) / 4);
}

function estimateLlmCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const costs =
    COST_PER_1M[model] ||
    Object.entries(COST_PER_1M).find(([k]) => model.startsWith(k))?.[1] ||
    COST_PER_1M[DEFAULT_MODEL];
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

// ── File utilities ──

function computeFileHash(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function truncate(text: string, max: number = 10240): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + `... [truncated, ${text.length} bytes]`;
}

// ── Guardrail config ──

interface GuardrailConfig {
  protectedFiles: string[];
  dangerousCommands: string[];
  blockedDirs: string[];
}

function loadGuardrailConfig(): GuardrailConfig {
  const defaults: GuardrailConfig = {
    protectedFiles: ['.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa', 'id_ed25519'],
    dangerousCommands: [
      'rm -rf /', 'rm -rf ~', 'rm -rf .', 'sudo rm',
      'DROP TABLE', 'DROP DATABASE', 'TRUNCATE TABLE',
      'curl * | bash', 'wget * | bash',
      '> /dev/sda', 'mkfs', 'dd if=',
    ],
    blockedDirs: ['/etc', '/usr', '/var', '/sys', '/boot', '~/.ssh', '~/.gnupg'],
  };

  // Load custom config from .hawkeye/config.json if exists
  try {
    const configPath = join(process.cwd(), '.hawkeye', 'config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const rules = config.guardrails || [];
      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (rule.type === 'file_protect' && rule.config?.paths) {
          defaults.protectedFiles = rule.config.paths;
        }
        if (rule.type === 'command_block' && rule.config?.patterns) {
          defaults.dangerousCommands = rule.config.patterns;
        }
        if (rule.type === 'directory_scope' && rule.config?.blockedDirs) {
          defaults.blockedDirs = rule.config.blockedDirs;
        }
      }
    }
  } catch {}

  return defaults;
}

// ── Session tracking ──

interface HookSession {
  hawkeyeSessionId: string;
  claudeSessionId: string;
  objective: string;
  startedAt: string;
  lastActivityAt: string;
  eventCount: number;
  totalCostUsd: number;
  driftScores: number[];
  model: string;
}

function getHawkDir(): string {
  return join(process.cwd(), '.hawkeye');
}

function getSessionsFile(): string {
  return join(getHawkDir(), 'hook-sessions.json');
}

function loadSessions(): Record<string, HookSession> {
  const file = getSessionsFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSessions(sessions: Record<string, HookSession>): void {
  const dir = getHawkDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSessionsFile(), JSON.stringify(sessions, null, 2));
}

function getOrCreateSession(
  claudeSessionId: string,
  storage: Storage,
  objective?: string,
): HookSession {
  const sessions = loadSessions();

  if (sessions[claudeSessionId]) {
    sessions[claudeSessionId].lastActivityAt = new Date().toISOString();
    saveSessions(sessions);
    return sessions[claudeSessionId];
  }

  const sessionId = randomUUID();
  const now = new Date();

  storage.createSession({
    id: sessionId,
    objective: objective || 'Claude Code Session',
    startedAt: now,
    status: 'recording',
    metadata: {
      agent: 'claude-code',
      model: DEFAULT_MODEL,
      workingDir: process.cwd(),
    },
  });

  const hookSession: HookSession = {
    hawkeyeSessionId: sessionId,
    claudeSessionId,
    objective: objective || 'Claude Code Session',
    startedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    eventCount: 0,
    totalCostUsd: 0,
    driftScores: [],
    model: DEFAULT_MODEL,
  };

  sessions[claudeSessionId] = hookSession;
  saveSessions(sessions);
  return hookSession;
}

function updateSessionTracking(
  claudeSessionId: string,
  costUsd: number,
  driftScore?: number,
): void {
  const sessions = loadSessions();
  const session = sessions[claudeSessionId];
  if (!session) return;

  session.eventCount++;
  session.totalCostUsd += costUsd;
  session.lastActivityAt = new Date().toISOString();
  if (driftScore !== undefined) {
    session.driftScores.push(driftScore);
  }
  saveSessions(sessions);
}

// ── Guardrail checks ──

function matchesGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`(^|/)${regex}$`).test(filePath);
}

function checkFileProtection(
  toolName: string,
  toolInput: Record<string, unknown>,
  config: GuardrailConfig,
): string | null {
  if (!['Write', 'Edit', 'Bash'].includes(toolName)) return null;

  let filePath = '';
  if (toolName === 'Write' || toolName === 'Edit') {
    filePath = String(toolInput.file_path || toolInput.path || '');
  } else if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '');
    for (const pattern of config.protectedFiles) {
      const cleanPattern = pattern.replace(/\*/g, '');
      if (cleanPattern && cmd.includes(cleanPattern)) {
        return `Command references protected file pattern: ${pattern}`;
      }
    }
    return null;
  }

  if (!filePath) return null;

  for (const pattern of config.protectedFiles) {
    if (matchesGlob(filePath, pattern)) {
      return `File "${filePath}" matches protected pattern "${pattern}"`;
    }
  }
  return null;
}

function checkDangerousCommand(
  toolName: string,
  toolInput: Record<string, unknown>,
  config: GuardrailConfig,
): string | null {
  if (toolName !== 'Bash') return null;
  const cmd = String(toolInput.command || '');
  if (!cmd) return null;

  for (const pattern of config.dangerousCommands) {
    const check = pattern.replace(/\*/g, '');
    if (check && cmd.includes(check)) {
      return `Command matches dangerous pattern: "${pattern}"`;
    }
  }
  return null;
}

function checkDirectoryScope(
  toolName: string,
  toolInput: Record<string, unknown>,
  config: GuardrailConfig,
): string | null {
  let targetPath = '';

  if (['Write', 'Edit', 'Read'].includes(toolName)) {
    targetPath = String(toolInput.file_path || toolInput.path || '');
  } else if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '');
    for (const dir of config.blockedDirs) {
      const expanded = dir.replace('~', process.env.HOME || '/root');
      if (cmd.includes(expanded) || cmd.includes(dir)) {
        return `Command accesses blocked directory: ${dir}`;
      }
    }
    return null;
  }

  if (!targetPath) return null;

  for (const dir of config.blockedDirs) {
    const expanded = dir.replace('~', process.env.HOME || '/root');
    if (targetPath.startsWith(expanded) || targetPath.startsWith(dir)) {
      return `Path "${targetPath}" is in blocked directory "${dir}"`;
    }
  }
  return null;
}

// ── Event mapping ──

function mapToolToEventType(toolName: string): EventType {
  switch (toolName) {
    case 'Bash':
      return 'command';
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return 'file_write';
    case 'Read':
      return 'file_read';
    case 'Glob':
    case 'Grep':
      return 'file_read';
    default:
      return 'api_call';
  }
}

function buildEventData(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: string,
): Record<string, unknown> {
  switch (toolName) {
    case 'Bash': {
      const command = String(toolInput.command || '');
      // Detect exit code from output patterns
      let exitCode: number | undefined;
      if (toolOutput) {
        const exitMatch = toolOutput.match(
          /(?:exit(?:ed with)?\s+(?:code\s+)?|returned?\s+)(\d+)/i,
        );
        if (exitMatch) exitCode = parseInt(exitMatch[1]);
        // Heuristic: if output contains error indicators without explicit exit code
        if (
          exitCode === undefined &&
          /\b(?:error|failed|ENOENT|Permission denied|command not found)\b/i.test(
            toolOutput,
          )
        ) {
          exitCode = 1;
        }
      }
      return {
        command,
        args: [],
        cwd: String(toolInput.cwd || process.cwd()),
        exitCode: exitCode ?? 0,
        stdout: toolOutput ? truncate(toolOutput) : undefined,
      };
    }
    case 'Write': {
      const filePath = String(toolInput.file_path || toolInput.path || '');
      return {
        path: filePath,
        action: 'write',
        sizeBytes: getFileSize(filePath),
        contentHash: computeFileHash(filePath),
      };
    }
    case 'Edit': {
      const filePath = String(toolInput.file_path || toolInput.path || '');
      return {
        path: filePath,
        action: 'write',
        sizeBytes: getFileSize(filePath),
        contentHash: computeFileHash(filePath),
        // Approximate line diff from old_string/new_string if available
        linesAdded: toolInput.new_string
          ? String(toolInput.new_string).split('\n').length
          : undefined,
        linesRemoved: toolInput.old_string
          ? String(toolInput.old_string).split('\n').length
          : undefined,
      };
    }
    case 'Read': {
      const filePath = String(toolInput.file_path || toolInput.path || '');
      return {
        path: filePath,
        action: 'read',
        sizeBytes: getFileSize(filePath),
      };
    }
    case 'Glob':
    case 'Grep':
      return {
        path: String(toolInput.pattern || toolInput.path || ''),
        action: 'read',
        sizeBytes: 0,
      };
    default:
      return { tool: toolName, input: toolInput };
  }
}

// ── Drift detection (heuristic, inline — must be fast) ──

const DRIFT_CHECK_EVERY = 5;

function runDriftCheck(
  storage: Storage,
  hawkeyeSessionId: string,
  eventId: string,
  eventCount: number,
  driftScores: number[],
  objective: string,
): { score: number; flag: DriftFlag } | null {
  // Only check every N events
  if (eventCount % DRIFT_CHECK_EVERY !== 0) return null;
  if (eventCount < DRIFT_CHECK_EVERY) return null;

  try {
    const eventsResult = storage.getEvents(hawkeyeSessionId, { limit: 20 });
    if (!eventsResult.ok || eventsResult.value.length < 3) return null;

    // Convert EventRows to TraceEvents for the scorer
    const traceEvents: TraceEvent[] = eventsResult.value.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: new Date(row.timestamp),
      sequence: row.sequence,
      type: row.type as EventType,
      data: JSON.parse(row.data),
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
    }));

    const result = scoreHeuristic(traceEvents, {
      objective,
      workingDir: process.cwd(),
    });

    // Update sliding score
    driftScores.push(result.score);
    const sliding = slidingDriftScore(driftScores);

    // Persist drift snapshot
    storage.insertDriftSnapshot(hawkeyeSessionId, eventId, {
      score: sliding,
      flag: result.flag,
      reason: result.reason,
      suggestion: null,
      source: 'heuristic',
    });

    return { score: sliding, flag: result.flag };
  } catch {
    return null;
  }
}

// ── Read stdin ──

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // Timeout after 5s (Claude Code hooks have a timeout)
    setTimeout(() => resolve(data), 5000);
  });
}

// ── Command ──

export const hookHandlerCommand = new Command('hook-handler')
  .description('Internal: Claude Code hook handler')
  .option(
    '--event <type>',
    'Hook event type (PreToolUse, PostToolUse, Stop)',
    'PostToolUse',
  )
  .action(async (options) => {
    try {
      const input = await readStdin();
      if (!input.trim()) {
        process.exit(0);
      }

      const hookData = JSON.parse(input);
      const claudeSessionId = hookData.session_id || 'unknown';
      const eventType = options.event;

      // Ensure .hawkeye directory exists
      const hawkDir = getHawkDir();
      if (!existsSync(hawkDir)) mkdirSync(hawkDir, { recursive: true });

      const dbPath = join(hawkDir, 'traces.db');
      const storage = new Storage(dbPath);

      try {
        if (eventType === 'PreToolUse') {
          // ── Guardrail evaluation ──
          const toolName = hookData.tool_name || '';
          const toolInput = (hookData.tool_input || {}) as Record<
            string,
            unknown
          >;
          const config = loadGuardrailConfig();

          const violations: string[] = [];
          const fileCheck = checkFileProtection(toolName, toolInput, config);
          if (fileCheck) violations.push(fileCheck);
          const cmdCheck = checkDangerousCommand(toolName, toolInput, config);
          if (cmdCheck) violations.push(cmdCheck);
          const dirCheck = checkDirectoryScope(toolName, toolInput, config);
          if (dirCheck) violations.push(dirCheck);

          if (violations.length > 0) {
            // Record the guardrail block event
            const session = getOrCreateSession(
              claudeSessionId,
              storage,
              hookData.objective,
            );
            const seq = storage.getNextSequence(session.hawkeyeSessionId);
            const eventId = randomUUID();

            storage.insertEvent({
              id: eventId,
              sessionId: session.hawkeyeSessionId,
              timestamp: new Date(),
              sequence: seq,
              type: 'guardrail_block' as EventType,
              data: {
                ruleName: 'hook_guardrail',
                severity: 'block' as const,
                description: violations.join('; '),
                blockedAction: `${toolName}: ${JSON.stringify(toolInput).slice(0, 200)}`,
              } as unknown as TraceEvent['data'],
              durationMs: 0,
              costUsd: 0,
            });

            for (const desc of violations) {
              storage.insertGuardrailViolation(
                session.hawkeyeSessionId,
                eventId,
                {
                  ruleName: 'hook_guardrail',
                  severity: 'block',
                  description: desc,
                  actionTaken: 'blocked',
                },
              );
            }

            // Output block reason and exit 2
            process.stdout.write(
              JSON.stringify({
                decision: 'block',
                reason: `Hawkeye Guardrail: ${violations.join('; ')}`,
              }),
            );
            storage.close();
            process.exit(2);
          }

          // Allow the action
          storage.close();
          process.exit(0);
        } else if (eventType === 'PostToolUse') {
          // ── Record the completed action with full data ──
          const toolName = hookData.tool_name || '';
          const toolInput = (hookData.tool_input || {}) as Record<
            string,
            unknown
          >;
          const toolOutput =
            typeof hookData.tool_output === 'string'
              ? hookData.tool_output
              : hookData.tool_output
                ? JSON.stringify(hookData.tool_output)
                : undefined;

          const session = getOrCreateSession(
            claudeSessionId,
            storage,
            hookData.objective,
          );
          const seq = storage.getNextSequence(session.hawkeyeSessionId);
          const type = mapToolToEventType(toolName);
          const data = buildEventData(toolName, toolInput, toolOutput);
          const eventId = randomUUID();

          // ── LLM cost estimation ──
          // Each Claude Code tool use involves at least one LLM call.
          // Estimate tokens from tool input/output sizes.
          const inputText = JSON.stringify(toolInput);
          const outputText = toolOutput || '';

          // Use explicit token counts from hook data if available (newer Claude Code versions)
          const inputTokens =
            hookData.input_tokens || estimateTokens(inputText) + 500; // +500 for system prompt overhead
          const outputTokens =
            hookData.output_tokens || estimateTokens(outputText) + 50;

          const model = hookData.model || session.model || DEFAULT_MODEL;
          const costUsd = estimateLlmCost(model, inputTokens, outputTokens);

          // Insert the tool action event
          storage.insertEvent({
            id: eventId,
            sessionId: session.hawkeyeSessionId,
            timestamp: new Date(),
            sequence: seq,
            type,
            data: data as unknown as TraceEvent['data'],
            durationMs: hookData.duration_ms || 0,
            costUsd,
          });

          // Also insert a synthetic llm_call event to track token usage
          const llmSeq = storage.getNextSequence(session.hawkeyeSessionId);
          storage.insertEvent({
            id: randomUUID(),
            sessionId: session.hawkeyeSessionId,
            timestamp: new Date(),
            sequence: llmSeq,
            type: 'llm_call',
            data: {
              provider: 'anthropic',
              model,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              totalTokens: inputTokens + outputTokens,
              costUsd,
              latencyMs: hookData.duration_ms || 0,
            } as unknown as TraceEvent['data'],
            durationMs: hookData.duration_ms || 0,
            costUsd,
          });

          // ── Drift detection ──
          const drift = runDriftCheck(
            storage,
            session.hawkeyeSessionId,
            eventId,
            session.eventCount + 1,
            [...session.driftScores],
            session.objective,
          );

          // Update event with drift info if we got a score
          if (drift) {
            storage.updateEventDrift(eventId, drift.score, drift.flag);
          }

          // Update session tracking
          updateSessionTracking(
            claudeSessionId,
            costUsd,
            drift?.score,
          );

          storage.close();
          process.exit(0);
        } else if (eventType === 'Stop') {
          // ── Session end ──
          const sessions = loadSessions();
          const hookSession = sessions[claudeSessionId];

          if (hookSession) {
            // Compute final drift score
            const finalDrift =
              hookSession.driftScores.length > 0
                ? slidingDriftScore(hookSession.driftScores)
                : null;

            if (finalDrift !== null) {
              storage.updateFinalDriftScore(
                hookSession.hawkeyeSessionId,
                finalDrift,
              );
            }

            // End the session
            storage.endSession(hookSession.hawkeyeSessionId, 'completed');

            // Record session_end event
            const seq = storage.getNextSequence(hookSession.hawkeyeSessionId);
            storage.insertEvent({
              id: randomUUID(),
              sessionId: hookSession.hawkeyeSessionId,
              timestamp: new Date(),
              sequence: seq,
              type: 'session_end' as EventType,
              data: {
                description: hookData.stop_reason || 'Session ended',
                reasoning: `Total cost: $${hookSession.totalCostUsd.toFixed(4)}, Events: ${hookSession.eventCount}`,
              } as unknown as TraceEvent['data'],
              durationMs: 0,
              costUsd: 0,
            });

            // Remove from active sessions
            delete sessions[claudeSessionId];
            saveSessions(sessions);
          }

          storage.close();
          process.exit(0);
        } else {
          // Unknown event type — just record as-is
          storage.close();
          process.exit(0);
        }
      } catch (innerErr) {
        try {
          storage.close();
        } catch {}
        throw innerErr;
      }
    } catch (err) {
      // Never crash — always exit cleanly so we don't block Claude Code
      process.stderr.write(`hawkeye hook-handler error: ${String(err)}\n`);
      process.exit(0);
    }
  });
