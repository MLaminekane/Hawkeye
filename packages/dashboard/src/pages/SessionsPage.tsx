import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, type SessionData } from '../api';

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = () => {
      api.listSessions().then((data) => {
        setSessions(data);
        setLoading(false);
      }).catch(() => setLoading(false));
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    let result = sessions;
    if (statusFilter) result = result.filter((s) => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((s) =>
        s.objective.toLowerCase().includes(q) ||
        (s.agent || '').toLowerCase().includes(q) ||
        s.id.includes(q)
      );
    }
    return result;
  }, [sessions, statusFilter, search]);

  if (loading) {
    return <div className="text-hawk-text3 font-mono text-sm p-8">Loading...</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-5xl mb-4 opacity-30">H</div>
        <h2 className="font-display text-xl font-semibold text-hawk-text mb-2">No sessions yet</h2>
        <p className="text-hawk-text3 text-sm max-w-md mb-4">
          Start recording an AI agent session to see it here.
        </p>
        <code className="rounded-lg bg-hawk-surface border border-hawk-border px-4 py-2 font-mono text-sm text-hawk-orange">
          hawkeye record -o "your objective" -- agent-command
        </code>
      </div>
    );
  }

  // Status counts
  const statusCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-hawk-text">Sessions</h1>
        <span className="font-mono text-xs text-hawk-text3">{sessions.length} total</span>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search objectives, agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg bg-hawk-surface border border-hawk-border px-3 py-2 font-mono text-xs text-hawk-text placeholder-hawk-text3 outline-none focus:border-hawk-orange/50 transition-colors"
        />
        <div className="flex gap-1">
          {['recording', 'completed', 'aborted'].map((status) => (
            statusCounts[status] ? (
              <button
                key={status}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
                className={`rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase transition-all ${
                  statusFilter === status
                    ? 'ring-1 ring-hawk-orange bg-hawk-surface2'
                    : 'bg-hawk-surface hover:bg-hawk-surface2'
                } ${status === 'completed' ? 'text-hawk-green' : status === 'recording' ? 'text-hawk-orange' : 'text-hawk-red'}`}
              >
                {status} ({statusCounts[status]})
              </button>
            ) : null
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
        {filtered.length === 0 && sessions.length > 0 && (
          <div className="text-center py-8 text-hawk-text3 text-sm">
            No sessions match your filters.
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session: s }: { session: SessionData }) {
  const isRecording = s.status === 'recording';
  const duration = getDuration(s.started_at, s.ended_at);
  const driftColor = getDriftColor(s.final_drift_score);

  return (
    <Link
      to={`/session/${s.id}`}
      className="group block rounded-lg border border-hawk-border bg-hawk-surface overflow-hidden transition-all hover:border-hawk-orange/30"
    >
      {/* Top status line */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-hawk-border/50 bg-hawk-surface2/50">
        <div className="flex items-center gap-2">
          {isRecording ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hawk-orange opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-hawk-orange"></span>
              </span>
              <span className="font-mono text-[10px] font-bold text-hawk-orange uppercase">Recording</span>
            </>
          ) : s.status === 'completed' ? (
            <>
              <span className="h-2 w-2 rounded-full bg-hawk-green"></span>
              <span className="font-mono text-[10px] font-bold text-hawk-green uppercase">Completed</span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-hawk-red"></span>
              <span className="font-mono text-[10px] font-bold text-hawk-red uppercase">Aborted</span>
            </>
          )}
        </div>

        {s.agent && (
          <span className="rounded bg-hawk-surface3 px-1.5 py-0.5 font-mono text-[10px] text-hawk-text3">
            {s.agent}
          </span>
        )}

        <span className="font-mono text-[10px] text-hawk-text3">{s.id.slice(0, 8)}</span>

        <span className="ml-auto font-mono text-[10px] text-hawk-text3">{formatDate(s.started_at)}</span>
      </div>

      {/* Main content */}
      <div className="px-4 py-3">
        <h3 className="text-sm font-medium text-hawk-text mb-3 group-hover:text-hawk-orange transition-colors">
          {s.objective}
        </h3>

        {/* Stats row */}
        <div className="flex items-center gap-4 font-mono text-xs">
          <div className="flex items-center gap-1">
            <span className="text-hawk-text3">Duration:</span>
            <span className="text-hawk-text">{duration}</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-hawk-text3">Actions:</span>
            <span className="text-hawk-text font-semibold">{s.total_actions}</span>
          </div>

          {s.total_cost_usd > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-hawk-text3">Cost:</span>
              <span className="text-hawk-amber">${s.total_cost_usd.toFixed(4)}</span>
            </div>
          )}

          {s.final_drift_score != null && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-hawk-text3">Drift:</span>
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 rounded-full bg-hawk-surface3 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${driftColor === 'text-hawk-green' ? 'bg-hawk-green' : driftColor === 'text-hawk-amber' ? 'bg-hawk-amber' : 'bg-hawk-red'}`}
                    style={{ width: `${s.final_drift_score}%` }}
                  />
                </div>
                <span className={`font-semibold ${driftColor}`}>{s.final_drift_score}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function getDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getDriftColor(score: number | null): string {
  if (score == null) return 'text-hawk-text3';
  if (score >= 70) return 'text-hawk-green';
  if (score >= 40) return 'text-hawk-amber';
  return 'text-hawk-red';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}
