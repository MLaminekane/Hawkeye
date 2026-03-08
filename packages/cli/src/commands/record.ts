import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { createRecorder, type DriftCheckResult, type GuardrailViolation } from '@hawkeye/core';

export const recordCommand = new Command('record')
  .description('Record an AI agent session')
  .requiredOption('-o, --objective <text>', 'The objective for this session')
  .option('-a, --agent <name>', 'Agent name (auto-detected from command)', 'unknown')
  .option('-m, --model <name>', 'Model name')
  .option('--no-drift', 'Disable drift detection')
  .option('--no-guardrails', 'Disable guardrails')
  .argument('[command...]', 'The command to run (after --)')
  .action(async (commandArgs: string[], options) => {
    if (commandArgs.length === 0) {
      console.error(chalk.red('Error: No command specified.'));
      console.error(
        chalk.dim('Usage: hawkeye record -o "objective" -- <command>'),
      );
      process.exit(1);
    }

    const cwd = process.cwd();
    const hawkDir = join(cwd, '.hawkeye');
    const dbPath = join(hawkDir, 'traces.db');

    // Auto-create .hawkeye if it doesn't exist
    if (!existsSync(hawkDir)) {
      mkdirSync(hawkDir, { recursive: true });
    }

    // Detect agent from command
    const agentCommand = commandArgs[0];
    const agent = options.agent !== 'unknown' ? options.agent : detectAgent(agentCommand);

    // For Claude Code, recommend hooks instead of record (preload doesn't work with bundled runtime)
    if (agent === 'claude-code') {
      console.log(chalk.yellow('  Note: Claude Code uses a bundled Node.js runtime.'));
      console.log(chalk.yellow('  For full event capture (LLM costs, drift, guardrails), use hooks:'));
      console.log('');
      console.log(chalk.cyan('    hawkeye hooks install'));
      console.log(chalk.dim('    Then use Claude Code normally — events are captured automatically.'));
      console.log('');
      console.log(chalk.dim('  Continuing with record mode (file events + partial network capture)...'));
      console.log('');
    }

    const recorder = createRecorder({
      objective: options.objective,
      agent,
      model: options.model,
      workingDir: cwd,
      dbPath,
      drift: options.drift !== false
        ? {
            enabled: true,
            checkEvery: 5,
            provider: 'ollama',
            model: 'llama3.2',
            thresholds: { warning: 60, critical: 30 },
            contextWindow: 10,
            autoPause: false,
          }
        : { enabled: false, checkEvery: 5, provider: 'ollama', model: '', thresholds: { warning: 60, critical: 30 }, contextWindow: 10, autoPause: false },
      guardrails: options.guardrails !== false
        ? {
            enabled: true,
            rules: [
              {
                name: 'protected_files',
                type: 'file_protect',
                paths: ['.env', '.env.*', '*.pem', '*.key'],
                action: 'block',
              },
              {
                name: 'dangerous_commands',
                type: 'command_block',
                patterns: ['rm -rf /', 'rm -rf ~', 'sudo rm', 'DROP TABLE'],
                action: 'block',
              },
              {
                name: 'cost_limit',
                type: 'cost_limit',
                maxUsdPerSession: 5.0,
                maxUsdPerHour: 2.0,
                action: 'block',
              },
            ],
          }
        : { enabled: false, rules: [] },
    });

    // Wire up drift alerts to CLI output
    recorder.onDriftAlert((result: DriftCheckResult) => {
      console.error('');
      if (result.flag === 'critical') {
        console.error(chalk.red(`  ⚠ DRIFT CRITICAL — Score: ${result.score}/100`));
      } else {
        console.error(chalk.yellow(`  ⚠ DRIFT WARNING — Score: ${result.score}/100`));
      }
      console.error(chalk.dim(`    ${result.reason}`));
      if (result.suggestion) {
        console.error(chalk.dim(`    Suggestion: ${result.suggestion}`));
      }
      console.error('');
    });

    // Wire up guardrail violations to CLI output
    recorder.onGuardrailViolation((violation: GuardrailViolation) => {
      console.error('');
      if (violation.severity === 'block') {
        console.error(chalk.red(`  ⛔ GUARDRAIL BLOCKED [${violation.ruleName}]`));
      } else {
        console.error(chalk.yellow(`  ⚠ GUARDRAIL WARNING [${violation.ruleName}]`));
      }
      console.error(chalk.dim(`    ${violation.description}`));
      console.error('');
    });

    recorder.start();

    const driftStatus = options.drift !== false ? chalk.green('on') : chalk.dim('off');
    const guardStatus = options.guardrails !== false ? chalk.green('on') : chalk.dim('off');

    console.log(chalk.green('● Recording started'));
    console.log(chalk.dim(`  Session:    ${recorder.sessionId}`));
    console.log(chalk.dim(`  Objective:  ${options.objective}`));
    console.log(chalk.dim(`  Agent:      ${agent}`));
    console.log(chalk.dim(`  Drift:      ${driftStatus}  Guardrails: ${guardStatus}`));
    console.log('');

    // Write the network preload script for child process interception
    const preloadPath = join(hawkDir, '_preload.mjs');
    writeFileSync(preloadPath, generatePreloadScript());

    // Spawn the wrapped command with IPC channel + network preload
    const [cmd, ...args] = commandArgs;
    const existingNodeOpts = process.env.NODE_OPTIONS || '';
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        NODE_OPTIONS: `${existingNodeOpts} --import file://${preloadPath}`.trim(),
      },
    });

    // Listen for LLM events from child process via IPC
    child.on('message', (msg: unknown) => {
      const m = msg as { type?: string; event?: Record<string, unknown> };
      if (m?.type === 'hawkeye:llm' && m.event) {
        recorder.recordLlmEvent(m.event as unknown as import('@hawkeye/core').LlmEvent);
      }
    });

    // Ignore IPC disconnect errors (child may not be Node.js)
    child.on('error', () => {});

    const cleanup = (status: 'completed' | 'aborted') => {
      recorder.stop(status);
      console.log('');
      console.log(
        chalk.green(`● Session ${status}: ${chalk.bold(recorder.sessionId)}`),
      );
      console.log(
        chalk.dim(`  View: hawkeye stats ${recorder.sessionId}`),
      );
    };

    child.on('close', (code) => {
      cleanup(code === 0 ? 'completed' : 'aborted');
      process.exit(code ?? 1);
    });

    process.on('SIGINT', () => {
      cleanup('aborted');
      child.kill('SIGINT');
      process.exit(130);
    });

    process.on('SIGTERM', () => {
      cleanup('aborted');
      child.kill('SIGTERM');
      process.exit(143);
    });
  });

function detectAgent(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes('claude')) return 'claude-code';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('copilot')) return 'copilot';
  if (lower.includes('autogpt') || lower.includes('auto-gpt')) return 'autogpt';
  if (lower.includes('crewai')) return 'crewai';
  if (lower.includes('aider')) return 'aider';
  return command;
}

/**
 * Generates a self-contained ESM preload script that monkey-patches
 * http/https.request AND globalThis.fetch in the child process to capture
 * LLM API calls and send them back to the parent process via IPC.
 *
 * fetch() patching is critical because modern SDKs (Anthropic SDK, OpenAI SDK)
 * use Node.js native fetch (undici) which bypasses http.request entirely.
 */
function generatePreloadScript(): string {
  return `
import http from 'node:http';
import https from 'node:https';

const LLM_HOSTS = new Set([
  'api.anthropic.com', 'api.openai.com',
  'api.deepseek.com', 'api.mistral.ai',
  'generativelanguage.googleapis.com',
  'localhost:11434', '127.0.0.1:11434',
]);

const LLM_PATHS = {
  '/v1/messages': 'anthropic',
  '/v1/chat/completions': 'openai',
  '/api/generate': 'ollama',
  '/api/chat': 'ollama',
};

const COST_TABLE = {
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'o3': { input: 2, output: 8 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'deepseek-chat': { input: 0.28, output: 0.42 },
  'deepseek-reasoner': { input: 0.28, output: 0.42 },
  'mistral-large-latest': { input: 0.5, output: 1.5 },
  'mistral-small-latest': { input: 0.1, output: 0.3 },
  'codestral-latest': { input: 0.3, output: 0.9 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

function sendEvent(event) {
  try {
    if (typeof process.send === 'function') {
      process.send({ type: 'hawkeye:llm', event });
    }
  } catch {}
}

function detectProvider(hostname, port, path, headers) {
  const hostPort = port ? hostname + ':' + port : hostname;
  if (LLM_HOSTS.has(hostPort) || LLM_HOSTS.has(hostname)) {
    if (hostname.includes('anthropic')) return 'anthropic';
    if (hostname.includes('openai')) return 'openai';
    if (hostname.includes('deepseek')) return 'deepseek';
    if (hostname.includes('mistral')) return 'mistral';
    if (hostname.includes('googleapis')) return 'google';
    return 'ollama';
  }
  if (LLM_HOSTS.has(hostname)) {
    if (hostname.includes('anthropic')) return 'anthropic';
    if (hostname.includes('openai')) return 'openai';
    if (hostname.includes('deepseek')) return 'deepseek';
    if (hostname.includes('mistral')) return 'mistral';
    if (hostname.includes('googleapis')) return 'google';
    return 'ollama';
  }
  const basePath = (path || '/').split('?')[0];
  if (LLM_PATHS[basePath]) {
    const lp = LLM_PATHS[basePath];
    if (lp === 'anthropic') {
      if (headers && (headers['anthropic-version'] || headers['x-api-key'])) return 'anthropic';
      return null;
    }
    return lp;
  }
  return null;
}

function extractTokens(provider, body) {
  const u = body.usage || {};
  if (provider === 'anthropic') {
    return { model: body.model || 'unknown', input: u.input_tokens || 0, output: u.output_tokens || 0 };
  }
  if (provider === 'openai') {
    return { model: body.model || 'unknown', input: u.prompt_tokens || 0, output: u.completion_tokens || 0 };
  }
  return { model: body.model || 'unknown', input: body.prompt_eval_count || 0, output: body.eval_count || 0 };
}

function estimateCost(model, input, output) {
  const c = COST_TABLE[model] || Object.entries(COST_TABLE).find(([k]) => model.startsWith(k))?.[1];
  if (!c) return 0;
  return (input * c.input + output * c.output) / 1000000;
}

// ── Patch fetch() (used by Anthropic SDK, OpenAI SDK, and modern Node.js apps) ──
const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = async function patchedFetch(input, init) {
    const startTime = Date.now();
    let url;
    try {
      if (typeof input === 'string') {
        url = new URL(input);
      } else if (input instanceof URL) {
        url = input;
      } else if (input && typeof input === 'object' && input.url) {
        url = new URL(input.url);
      }
    } catch {}

    if (!url) return originalFetch.call(this, input, init);

    const headers = {};
    const rawHeaders = init?.headers || (input && typeof input === 'object' ? input.headers : null);
    if (rawHeaders) {
      if (typeof rawHeaders.forEach === 'function') {
        rawHeaders.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      } else if (typeof rawHeaders === 'object') {
        for (const [k, v] of Object.entries(rawHeaders)) {
          headers[k.toLowerCase()] = v;
        }
      }
    }

    const provider = detectProvider(url.hostname, url.port, url.pathname, headers);
    if (!provider) return originalFetch.call(this, input, init);

    const response = await originalFetch.call(this, input, init);
    if (!response.ok) return response;

    // Clone so we can read the body without consuming the original
    const cloned = response.clone();
    const contentType = response.headers.get('content-type') || '';

    cloned.text().then((text) => {
      try {
        const latencyMs = Date.now() - startTime;

        if (contentType.includes('text/event-stream')) {
          // SSE streaming response (Anthropic/OpenAI streaming mode)
          // Parse SSE events to extract usage from message_start + message_delta
          let model = 'unknown';
          let inputTokens = 0;
          let outputTokens = 0;
          for (const line of text.split('\\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const evt = JSON.parse(data);
              // Anthropic streaming: message_start has model + input_tokens
              if (evt.type === 'message_start' && evt.message) {
                model = evt.message.model || model;
                inputTokens = evt.message.usage?.input_tokens || 0;
              }
              // Anthropic streaming: message_delta has output_tokens
              if (evt.type === 'message_delta' && evt.usage) {
                outputTokens = evt.usage.output_tokens || 0;
              }
              // OpenAI streaming: last chunk may have usage
              if (evt.usage) {
                if (evt.usage.prompt_tokens) inputTokens = evt.usage.prompt_tokens;
                if (evt.usage.completion_tokens) outputTokens = evt.usage.completion_tokens;
              }
              if (evt.model) model = evt.model;
            } catch {}
          }
          if (inputTokens > 0 || outputTokens > 0) {
            const costUsd = estimateCost(model, inputTokens, outputTokens);
            sendEvent({
              provider, model, promptTokens: inputTokens, completionTokens: outputTokens,
              totalTokens: inputTokens + outputTokens, costUsd, latencyMs,
            });
          }
        } else {
          // Regular JSON response (non-streaming)
          const json = JSON.parse(text);
          const tokens = extractTokens(provider, json);
          const costUsd = estimateCost(tokens.model, tokens.input, tokens.output);
          sendEvent({
            provider, model: tokens.model,
            promptTokens: tokens.input, completionTokens: tokens.output,
            totalTokens: tokens.input + tokens.output, costUsd, latencyMs,
          });
        }
      } catch {}
    }).catch(() => {});

    return response;
  };
}

// ── Patch http/https.request (used by older Node.js apps and libraries) ──
function patchModule(mod) {
  const origRequest = mod.request;
  mod.request = function(...args) {
    const req = origRequest.apply(this, args);
    const first = args[0];
    let hostname, port, path, method;
    if (typeof first === 'string') {
      try { const u = new URL(first); hostname = u.hostname; port = u.port; path = u.pathname; method = 'GET'; } catch { return req; }
    } else if (first instanceof URL) {
      hostname = first.hostname; port = first.port; path = first.pathname; method = 'GET';
    } else if (first && typeof first === 'object') {
      hostname = (first.hostname || first.host || '').split(':')[0];
      port = first.port ? String(first.port) : (first.hostname || first.host || '').split(':')[1];
      path = first.path || '/';
      method = first.method || 'GET';
    } else { return req; }

    const headers = (first && typeof first === 'object' && !(first instanceof URL)) ? (first.headers || {}) : {};
    const provider = detectProvider(hostname, port, path, headers);
    if (!provider) return req;

    const startTime = Date.now();
    let requestBody = '';
    const origWrite = req.write.bind(req);
    const origEnd = req.end.bind(req);

    req.write = function(chunk, ...rest) {
      if (chunk) requestBody += typeof chunk === 'string' ? chunk : chunk.toString();
      return origWrite(chunk, ...rest);
    };
    req.end = function(chunk, ...rest) {
      if (chunk && typeof chunk !== 'function') requestBody += typeof chunk === 'string' ? chunk : chunk.toString();
      return origEnd(chunk, ...rest);
    };

    req.on('response', (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk.toString(); });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return;
        try {
          const json = JSON.parse(responseBody);
          const tokens = extractTokens(provider, json);
          const costUsd = estimateCost(tokens.model, tokens.input, tokens.output);
          sendEvent({
            provider,
            model: tokens.model,
            promptTokens: tokens.input,
            completionTokens: tokens.output,
            totalTokens: tokens.input + tokens.output,
            costUsd,
            latencyMs: Date.now() - startTime,
          });
        } catch {}
      });
    });

    return req;
  };
}

patchModule(http);
patchModule(https);
`;
}
