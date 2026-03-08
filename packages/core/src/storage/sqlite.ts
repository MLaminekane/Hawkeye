import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { SCHEMA } from './schema.js';
import type { AgentSession, TraceEvent, EventType, DriftFlag, Result } from '../types.js';
import type { GuardrailViolation } from '../guardrails/rules.js';
import type { DriftCheckResult } from '../drift/engine.js';

export interface SessionRow {
  id: string;
  objective: string;
  agent: string | null;
  model: string | null;
  working_dir: string;
  git_branch: string | null;
  git_commit_before: string | null;
  git_commit_after: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  total_cost_usd: number;
  total_tokens: number;
  total_actions: number;
  final_drift_score: number | null;
  metadata: string | null;
}

export interface EventRow {
  id: string;
  session_id: string;
  sequence: number;
  timestamp: string;
  type: string;
  data: string;
  drift_score: number | null;
  drift_flag: string | null;
  cost_usd: number;
  duration_ms: number;
}

export class Storage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  createSession(session: AgentSession): Result<string> {
    try {
      const id = session.id || uuid();
      this.db
        .prepare(
          `INSERT INTO sessions (id, objective, agent, model, working_dir, git_branch, git_commit_before, started_at, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          session.objective,
          session.metadata.agent,
          session.metadata.model ?? null,
          session.metadata.workingDir,
          session.metadata.gitBranch ?? null,
          session.metadata.gitCommitBefore ?? null,
          session.startedAt.toISOString(),
          session.status,
          JSON.stringify(session.metadata),
        );
      return { ok: true, value: id };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  endSession(
    sessionId: string,
    status: 'completed' | 'aborted',
    gitCommitAfter?: string,
  ): Result<void> {
    try {
      const stats = this.db
        .prepare(
          `SELECT COUNT(*) as total_actions, COALESCE(SUM(cost_usd), 0) as total_cost
         FROM events WHERE session_id = ?`,
        )
        .get(sessionId) as { total_actions: number; total_cost: number };

      this.db
        .prepare(
          `UPDATE sessions
         SET status = ?, ended_at = ?, git_commit_after = ?,
             total_actions = ?, total_cost_usd = ?
         WHERE id = ?`,
        )
        .run(
          status,
          new Date().toISOString(),
          gitCommitAfter ?? null,
          stats.total_actions,
          stats.total_cost,
          sessionId,
        );
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  insertEvent(event: TraceEvent): Result<string> {
    try {
      const id = event.id || uuid();
      this.db
        .prepare(
          `INSERT INTO events (id, session_id, sequence, timestamp, type, data, drift_score, drift_flag, cost_usd, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          event.sessionId,
          event.sequence,
          event.timestamp.toISOString(),
          event.type,
          JSON.stringify(event.data),
          event.driftScore ?? null,
          event.driftFlag ?? null,
          event.costUsd ?? 0,
          event.durationMs,
        );
      return { ok: true, value: id };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  getSession(sessionId: string): Result<SessionRow | null> {
    try {
      // Try exact match first, then prefix match
      let row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
        | SessionRow
        | undefined;
      if (!row && sessionId.length >= 4) {
        row = this.db
          .prepare('SELECT * FROM sessions WHERE id LIKE ? ORDER BY started_at DESC LIMIT 1')
          .get(`${sessionId}%`) as SessionRow | undefined;
      }
      return { ok: true, value: row ?? null };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  listSessions(options?: {
    limit?: number;
    status?: string;
  }): Result<SessionRow[]> {
    try {
      let query = 'SELECT * FROM sessions';
      const params: unknown[] = [];

      if (options?.status) {
        query += ' WHERE status = ?';
        params.push(options.status);
      }

      query += ' ORDER BY started_at DESC';

      if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = this.db.prepare(query).all(...params) as SessionRow[];
      return { ok: true, value: rows };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  getEvents(
    sessionId: string,
    options?: { type?: EventType; limit?: number },
  ): Result<EventRow[]> {
    try {
      let query = 'SELECT * FROM events WHERE session_id = ?';
      const params: unknown[] = [sessionId];

      if (options?.type) {
        query += ' AND type = ?';
        params.push(options.type);
      }

      query += ' ORDER BY sequence ASC';

      if (options?.limit) {
        query += ' LIMIT ?';
        params.push(options.limit);
      }

      const rows = this.db.prepare(query).all(...params) as EventRow[];
      return { ok: true, value: rows };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  getNextSequence(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) as max_seq FROM events WHERE session_id = ?')
      .get(sessionId) as { max_seq: number };
    return row.max_seq + 1;
  }

  insertDriftSnapshot(
    sessionId: string,
    eventId: string,
    result: DriftCheckResult,
  ): Result<string> {
    try {
      const id = uuid();
      this.db
        .prepare(
          `INSERT INTO drift_snapshots (id, session_id, event_id, score, flag, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, sessionId, eventId, result.score, result.flag, result.reason, new Date().toISOString());
      return { ok: true, value: id };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  insertGuardrailViolation(
    sessionId: string,
    eventId: string,
    violation: GuardrailViolation,
  ): Result<string> {
    try {
      const id = uuid();
      this.db
        .prepare(
          `INSERT INTO guardrail_violations (id, session_id, event_id, rule_name, severity, description, action_taken, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          sessionId,
          eventId,
          violation.ruleName,
          violation.severity,
          violation.description,
          violation.actionTaken,
          new Date().toISOString(),
        );
      return { ok: true, value: id };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  updateEventDrift(eventId: string, score: number, flag: string): Result<void> {
    try {
      this.db
        .prepare('UPDATE events SET drift_score = ?, drift_flag = ? WHERE id = ?')
        .run(score, flag, eventId);
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  updateFinalDriftScore(sessionId: string, score: number): Result<void> {
    try {
      this.db
        .prepare('UPDATE sessions SET final_drift_score = ? WHERE id = ?')
        .run(score, sessionId);
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  getDriftSnapshots(sessionId: string): Result<Array<{
    id: string;
    score: number;
    flag: string;
    reason: string;
    created_at: string;
  }>> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM drift_snapshots WHERE session_id = ? ORDER BY created_at ASC')
        .all(sessionId) as Array<{ id: string; score: number; flag: string; reason: string; created_at: string }>;
      return { ok: true, value: rows };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  deleteSession(sessionId: string): Result<void> {
    try {
      this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM drift_snapshots WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM guardrail_violations WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      return { ok: true, value: undefined };
    } catch (e) {
      return { ok: false, error: e as Error };
    }
  }

  close(): void {
    this.db.close();
  }
}
