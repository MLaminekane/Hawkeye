# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Hawkeye is an open-source observability and security tool for AI agents (Claude Code, Cursor, AutoGPT, CrewAI, etc.). It acts as a "flight recorder" that logs every action an agent performs, enables visual session replay, and includes **DriftDetect** (real-time objective drift detection) and **Guardrails** (file protection, command blocking, cost limits).

## Architecture

TypeScript monorepo using pnpm workspaces + Turborepo:

- `packages/core` — Node.js SDK: recorder engine, interceptors (terminal, filesystem, network), SQLite storage, DriftDetect engine, guardrails enforcer
- `packages/cli` — CLI (Commander.js + chalk). Commands: `init`, `record`, `replay`, `sessions`, `stats`, `serve`, `export`, `hooks`, `hook-handler`, `otel-export`
- `packages/dashboard` — React 19 + Vite + Tailwind CSS + Recharts web UI served by `hawkeye serve` on port 4242

### Data Flow

Interceptors capture events → Recorder evaluates guardrails (sync, blocking) → persists to SQLite → triggers drift check (async, non-blocking). The CLI's `serve` command exposes a REST API (`/api/sessions`, `/api/sessions/:id/events`, `/api/sessions/:id/drift`) and serves the dashboard as static files.

### Network Interception (Child Process)

The network interceptor works across process boundaries: `hawkeye record` writes a preload ESM script to `.hawkeye/_preload.mjs` and injects it into the child process via `NODE_OPTIONS="--import ..."`. The preload script monkey-patches `http/https.request` and `globalThis.fetch`, detects LLM calls by hostname or API path+headers (`/v1/messages` for Anthropic, `/v1/chat/completions` for OpenAI, `/api/generate` and `/api/chat` for Ollama), parses SSE streaming responses, and sends captured events back to the parent via Node.js IPC (`process.send()`).

### Claude Code Hooks Integration

For agents like Claude Code that use a bundled Node.js runtime (NODE_OPTIONS doesn't work), Hawkeye uses Claude Code hooks. `hawkeye hooks install` configures `.claude/settings.json` with PreToolUse (guardrails — exit code 2 blocks actions) and PostToolUse (event recording) hooks. The `hook-handler` reads JSON from stdin, evaluates guardrails, and writes events directly to SQLite. Sessions are auto-created per Claude Code session_id.

### Universal Ingestion API

`POST /api/ingest` accepts events from any source (MCP servers, custom agents, external tools). Auto-creates sessions if `session_id` is omitted. `POST /api/sessions/:id/end` closes a session.

### OpenTelemetry Export

`hawkeye otel-export <session-id>` exports sessions as OTLP JSON traces (compatible with Grafana Tempo, Jaeger, Datadog, Honeycomb). Session = root span, events = child spans. Supports direct push to OTLP HTTP endpoints via `--endpoint`.

## Build & Dev Commands

```bash
pnpm install                    # Install all dependencies
pnpm build                      # Production build (all packages)
pnpm dev                        # Dev mode (Turborepo watch)
pnpm test                       # Run all tests (Vitest)
pnpm --filter @hawkeye/core test  # Run only core tests
npx vitest run src/drift/scorer.test.ts  # Run a single test file (from package dir)
```

## Code Conventions

- TypeScript strict mode, ES2022 target, ESM modules
- File names in kebab-case
- Named exports only (no default exports except React components)
- `Result<T, E>` pattern for error handling (no throwing in core)
- Logging via `Logger` class from `src/logger.ts` (writes to stderr, not console.log)
- Formatting: Prettier (semi, singleQuote, trailingComma: all, printWidth: 100)

## Database

SQLite via `better-sqlite3` with WAL mode. Schema in `packages/core/src/storage/schema.ts`. Four tables: `sessions`, `events`, `drift_snapshots`, `guardrail_violations`. Manual migrations (no ORM). Local data directory: `.hawkeye/` (created by `hawkeye init`).

## DriftDetect

- Heuristic scorer (`drift/scorer.ts`): penalizes dangerous commands (rm -rf, DROP TABLE, curl|bash), suspicious paths (/etc, ~/.ssh), sensitive file extensions (.pem, .key, .env), high error rates
- LLM scorer: prompt templates in `drift/prompts.ts`, supports Ollama (default), Anthropic, OpenAI
- Sliding weighted average via `slidingDriftScore()`. Checks every N actions (configurable)
- Thresholds: ok (70-100), warning (40-69), critical (0-39)

## Guardrails

Rules evaluated synchronously before event persistence. Rule types: `file_protect` (glob patterns), `command_block` (regex patterns), `cost_limit` (per-session and per-hour), `token_limit`, `directory_scope`. Actions: `warn` or `block`. Blocked events are persisted as `guardrail_trigger` type.

## Design System (Dashboard)

- Dark mode default. Colors: bg `#09090B`, surface `#16161D`, accent `#FF6B2B` (orange)
- Drift indicators: green `#2ECC71` (ok), amber `#FFB443` (warning), red `#FF4757` (critical)
- Fonts: JetBrains Mono (code), Space Grotesk (headings), DM Sans (body)
