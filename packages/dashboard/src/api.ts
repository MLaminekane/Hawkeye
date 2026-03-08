const API_BASE = '/api';

export interface SessionData {
  id: string;
  objective: string;
  agent: string | null;
  model: string | null;
  working_dir: string;
  git_branch: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  total_cost_usd: number;
  total_tokens: number;
  total_actions: number;
  final_drift_score: number | null;
}

export interface EventData {
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

export interface DriftSnapshot {
  id: string;
  score: number;
  flag: string;
  reason: string;
  created_at: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface SettingsData {
  drift: {
    enabled: boolean;
    checkEvery: number;
    provider: string;
    model: string;
    warningThreshold: number;
    criticalThreshold: number;
    contextWindow: number;
  };
  guardrails: Array<{
    name: string;
    type: string;
    enabled: boolean;
    action: string;
    config: Record<string, unknown>;
  }>;
}

export const api = {
  listSessions: (limit = 50) =>
    fetchJson<SessionData[]>(`${API_BASE}/sessions?limit=${limit}`),

  getSession: (id: string) =>
    fetchJson<SessionData>(`${API_BASE}/sessions/${id}`),

  getEvents: (sessionId: string) =>
    fetchJson<EventData[]>(`${API_BASE}/sessions/${sessionId}/events`),

  getDriftSnapshots: (sessionId: string) =>
    fetchJson<DriftSnapshot[]>(`${API_BASE}/sessions/${sessionId}/drift`),

  getSettings: () =>
    fetchJson<SettingsData>(`${API_BASE}/settings`),

  saveSettings: (settings: SettingsData) =>
    postJson<{ ok: boolean }>(`${API_BASE}/settings`, settings),

  getProviders: () =>
    fetchJson<Record<string, string[]>>(`${API_BASE}/providers`),
};
