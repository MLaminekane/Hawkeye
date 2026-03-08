# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Hawkeye is an open-source observability and security tool for AI agents (Claude Code, Cursor, AutoGPT, CrewAI, Aider, etc.). It acts as a "flight recorder" that logs every action an agent performs, enables visual session replay, and includes **DriftDetect** (real-time objective drift detection) and **Guardrails** (file protection, command blocking, cost limits).

## Architecture

TypeScript monorepo using pnpm workspaces + Turborepo:

- `packages/core` — Node.js SDK: recorder engine, interceptors (terminal, filesystem, network), SQLite storage, DriftDetect engine, guardrails enforcer
- `packages/cli` — CLI (Commander.js + chalk). Commands: `init`, `record`, `replay`, `sessions`, `stats`, `serve`, `export`, `hooks`, `hook-handler`, `otel-export`, `end`, `restart`. Interactive TUI via raw-mode stdin with slash command picker.
- `packages/dashboard` — React 19 + Vite + Tailwind CSS + Recharts web UI served by `hawkeye serve` on port 4242

### Data Flow

Interceptors capture events → Recorder evaluates guardrails (sync, blocking) → persists to SQLite → triggers drift check (async, non-blocking). The CLI's `serve` command exposes a REST API (`/api/sessions`, `/api/sessions/:id/events`, `/api/sessions/:id/drift`, `/api/settings`, `/api/providers`, `/api/ingest`) and serves the dashboard as static files.

### Network Interception (Child Process)

The network interceptor works across process boundaries: `hawkeye record` writes a preload ESM script to `.hawkeye/_preload.mjs` and injects it into the child process via `NODE_OPTIONS="--import ..."`. The preload script monkey-patches `http/https.request` and `globalThis.fetch`, detects LLM calls by hostname or API path+headers (`/v1/messages` for Anthropic, `/v1/chat/completions` for OpenAI, `/api/generate` and `/api/chat` for Ollama), parses SSE streaming responses, and sends captured events back to the parent via Node.js IPC (`process.send()`).

### Claude Code Hooks Integration

For agents like Claude Code that use a bundled Node.js runtime (NODE_OPTIONS doesn't work), Hawkeye uses Claude Code hooks. `hawkeye hooks install` configures `.claude/settings.json` with PreToolUse (guardrails — exit code 2 blocks actions) and PostToolUse (event recording) hooks. The `hook-handler` reads JSON from stdin, evaluates guardrails, and writes events directly to SQLite. Sessions are auto-created per Claude Code session_id.

### Universal Ingestion API

`POST /api/ingest` accepts events from any source (MCP servers, custom agents, external tools). Auto-creates sessions if `session_id` is omitted. `POST /api/sessions/:id/end` closes a session.

### OpenTelemetry Export

`hawkeye otel-export <session-id>` exports sessions as OTLP JSON traces (compatible with Grafana Tempo, Jaeger, Datadog, Honeycomb). Session = root span, events = child spans. Supports direct push to OTLP HTTP endpoints via `--endpoint`.

### Interactive TUI

When `hawkeye` is run with no subcommand, it launches an interactive TUI (`packages/cli/src/interactive.ts`). Key implementation details:

- **Raw mode input** (`process.stdin.setRawMode(true)`) with custom `parseKeys()` for arrow keys, escape, ctrl combos
- **Slash command picker**: type `/` to open dropdown, arrow keys to navigate, Tab to complete, Escape to dismiss, live filtering as you type
- **Ghost text** `/ for commands` when buffer is empty
- **Piped mode fallback**: when stdin is not TTY, uses a line queue (`nextLine()`, `lineQueue[]`, `lineWaiter`) for proper async serialization
- Commands dispatch from `executeCommand()` to individual `cmdXxx()` functions
- Numeric input at main prompt selects from `lastSessions[]` array
- Settings management via sub-menus (DriftDetect, Guardrails, API Keys) using `loadConfig()`/`saveConfig()` from `config.ts`

### Configuration

Two config files exist (legacy):

- `hawkeye init` writes **YAML** to `.hawkeye/config.yaml` (legacy format)
- `hawkeye serve` and the interactive TUI read/write **JSON** to `.hawkeye/config.json` (canonical format)

The unified config module is `packages/cli/src/config.ts`:

- `HawkeyeConfig` = `{ drift: DriftSettings, guardrails: GuardrailRuleSetting[], apiKeys?: ApiKeysSettings }`
- `PROVIDER_MODELS` — map of provider → model list for 6 providers (ollama, anthropic, openai, deepseek, mistral, google)
- `loadConfig(cwd)` reads `.hawkeye/config.json`, merges with defaults
- `saveConfig(cwd, config)` writes back to `.hawkeye/config.json`

## Build & Dev Commands

```bash
pnpm install                    # Install all dependencies
pnpm build                      # Production build (all packages)
pnpm dev                        # Dev mode (Turborepo watch)
pnpm test                       # Run all tests (Vitest)
pnpm --filter @hawkeye/core test  # Run only core tests
pnpm --filter @hawkeye/cli build  # Build only CLI
npx vitest run src/drift/scorer.test.ts  # Run a single test file (from package dir)
```

## Code Conventions

- TypeScript strict mode, ES2022 target, ESM modules
- File names in kebab-case
- Named exports only (no default exports except React components)
- `Result<T, E>` pattern for error handling (no throwing in core)
- Logging via `Logger` class from `src/logger.ts` (writes to stderr, not console.log)
- Formatting: Prettier (semi, singleQuote, trailingComma: all, printWidth: 100)
- chalk v5 (ESM-only) for terminal colors, `o` = `chalk.hex('#FF6B2B')` accent color

## Database

SQLite via `better-sqlite3` with WAL mode. Schema in `packages/core/src/storage/schema.ts`. Four tables: `sessions`, `events`, `drift_snapshots`, `guardrail_violations`. Manual migrations (no ORM). Local data directory: `.hawkeye/` (created by `hawkeye init`). `Storage` class has `deleteSession()` method.

## DriftDetect

- Heuristic scorer (`drift/scorer.ts`): penalizes dangerous commands (rm -rf, DROP TABLE, curl|bash), suspicious paths (/etc, ~/.ssh), sensitive file extensions (.pem, .key, .env), high error rates
- LLM scorer: prompt templates in `drift/prompts.ts`, supports Ollama (default), Anthropic, OpenAI, DeepSeek, Mistral, Google
- Sliding weighted average via `slidingDriftScore()`. Checks every N actions (configurable)
- Thresholds: ok (70-100), warning (40-69), critical (0-39)

## Guardrails

Rules evaluated synchronously before event persistence. Rule types: `file_protect` (glob patterns), `command_block` (regex patterns), `cost_limit` (per-session and per-hour), `token_limit`, `directory_scope`. Actions: `warn` or `block`. Blocked events are persisted as `guardrail_trigger` type. Rule definitions in `packages/core/src/guardrails/rules.ts`.

## Design System (Dashboard)

- Dark mode default. Colors: bg `#09090B`, surface `#16161D`, accent `#FF6B2B` (orange)
- Drift indicators: green `#2ECC71` (ok), amber `#FFB443` (warning), red `#FF4757` (critical)
- Fonts: JetBrains Mono (code), Space Grotesk (headings), DM Sans (body)

## Key Files Reference

| File                                            | Purpose                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/cli/src/index.ts`                     | CLI entry point, Commander.js commands, auto-launches TUI if no subcommand          |
| `packages/cli/src/interactive.ts`               | Interactive TUI with raw-mode input, slash command picker, all `cmdXxx()` functions |
| `packages/cli/src/config.ts`                    | Unified config types, load/save, `PROVIDER_MODELS` map                              |
| `packages/cli/src/commands/record.ts`           | Record command, agent auto-detection, preload script generation                     |
| `packages/cli/src/commands/serve.ts`            | Dashboard server, REST API endpoints, EADDRINUSE handling                           |
| `packages/cli/src/commands/hooks.ts`            | Claude Code hooks install/uninstall/status                                          |
| `packages/cli/src/commands/hook-handler.ts`     | Internal hook handler (reads JSON from stdin)                                       |
| `packages/core/src/recorder.ts`                 | Core recorder engine                                                                |
| `packages/core/src/types.ts`                    | Core types (`DriftConfig`, `RecorderConfig`, event types)                           |
| `packages/core/src/storage/sqlite.ts`           | SQLite storage layer                                                                |
| `packages/core/src/guardrails/enforcer.ts`      | Guardrail rule evaluation engine                                                    |
| `packages/core/src/guardrails/rules.ts`         | Guardrail rule type definitions                                                     |
| `packages/core/src/drift/scorer.ts`             | Heuristic drift scorer                                                              |
| `packages/core/src/drift/engine.ts`             | DriftDetect engine (heuristic + LLM)                                                |
| `packages/dashboard/src/pages/SettingsPage.tsx` | Dashboard settings UI                                                               |
