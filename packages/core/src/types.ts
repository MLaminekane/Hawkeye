export interface AgentSession {
  id: string;
  objective: string;
  startedAt: Date;
  endedAt?: Date;
  status: 'recording' | 'paused' | 'completed' | 'aborted';
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  agent: string;
  model?: string;
  workingDir: string;
  gitBranch?: string;
  gitCommitBefore?: string;
  gitCommitAfter?: string;
}

export type EventType =
  | 'session_start'
  | 'session_end'
  | 'command'
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'file_rename'
  | 'api_call'
  | 'llm_call'
  | 'decision'
  | 'error'
  | 'guardrail_trigger'
  | 'guardrail_block'
  | 'drift_alert';

export type DriftFlag = 'ok' | 'warning' | 'critical';

export interface TraceEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  sequence: number;
  type: EventType;
  data: CommandEvent | FileEvent | ApiEvent | LlmEvent | DecisionEvent | GuardrailEventData | DriftAlertEventData;
  driftScore?: number;
  driftFlag?: DriftFlag;
  costUsd?: number;
  durationMs: number;
}

export interface CommandEvent {
  command: string;
  args: string[];
  cwd: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface FileEvent {
  path: string;
  oldPath?: string;
  action: 'read' | 'write' | 'delete' | 'rename';
  contentBefore?: string;
  contentAfter?: string;
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
  sizeBytes: number;
  contentHash?: string;
}

export interface ApiEvent {
  url: string;
  method: string;
  statusCode?: number;
  requestHeaders?: Record<string, string>;
  responseSizeBytes?: number;
  latencyMs: number;
}

export interface LlmEvent {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  prompt?: string;
  response?: string;
  toolCalls?: string[];
}

export interface DecisionEvent {
  description: string;
  reasoning?: string;
  alternatives?: string[];
}

export interface GuardrailEventData {
  ruleName: string;
  severity: 'warn' | 'block';
  description: string;
  blockedAction: string;
}

export interface DriftAlertEventData {
  score: number;
  previousScore: number;
  reason: string;
  suggestion?: string;
  actionsAnalyzed: number;
}

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface GuardrailRule {
  name: string;
  type: 'file_protect' | 'command_block' | 'cost_limit' | 'token_limit' | 'directory_scope';
  action: 'warn' | 'block';
}

export interface DriftConfig {
  enabled: boolean;
  checkEvery: number;
  provider: 'ollama' | 'anthropic' | 'openai' | 'deepseek' | 'mistral' | 'google';
  model: string;
  thresholds: {
    warning: number;
    critical: number;
  };
  contextWindow: number;
  autoPause: boolean;
}

export interface AppConfig {
  drift: DriftConfig;
  guardrails: {
    enabled: boolean;
    rules: GuardrailRule[];
  };
}
