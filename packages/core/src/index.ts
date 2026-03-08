export type {
  AgentSession,
  SessionMetadata,
  EventType,
  DriftFlag,
  TraceEvent,
  CommandEvent,
  FileEvent,
  ApiEvent,
  LlmEvent,
  DecisionEvent,
  GuardrailEventData,
  DriftAlertEventData,
  Result,
  GuardrailRule,
  DriftConfig,
  AppConfig,
} from './types.js';

export { Storage } from './storage/sqlite.js';
export type { SessionRow, EventRow } from './storage/sqlite.js';

export { createRecorder } from './recorder.js';
export type { Recorder, RecorderOptions, EventHandler, DriftAlertHandler, GuardrailViolationHandler } from './recorder.js';

export { createTerminalInterceptor } from './interceptors/terminal.js';
export type { TerminalInterceptor, CommandCallback } from './interceptors/terminal.js';

export { createFilesystemInterceptor } from './interceptors/filesystem.js';
export type { FilesystemInterceptor, FileCallback } from './interceptors/filesystem.js';

export { createNetworkInterceptor } from './interceptors/network.js';
export type { NetworkInterceptor, LlmCallback, ApiCallback } from './interceptors/network.js';

export { createDriftEngine } from './drift/engine.js';
export type { DriftEngine, DriftCheckResult, DriftAlertCallback } from './drift/engine.js';

export { scoreHeuristic, slidingDriftScore } from './drift/scorer.js';
export type { DriftResult } from './drift/scorer.js';

export { buildDriftPrompt, parseDriftResponse } from './drift/prompts.js';
export type { DriftLlmResponse } from './drift/prompts.js';

export { createGuardrailEnforcer } from './guardrails/enforcer.js';
export type { GuardrailEnforcer, ViolationCallback } from './guardrails/enforcer.js';

export type {
  GuardrailRuleConfig,
  GuardrailViolation,
  FileProtectRule,
  CommandBlockRule,
  CostLimitRule,
  TokenLimitRule,
  DirectoryScopeRule,
} from './guardrails/rules.js';

export { Logger } from './logger.js';
