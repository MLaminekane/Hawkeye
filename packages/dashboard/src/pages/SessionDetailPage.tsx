import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts';
import { api, hawkeyeWs, type SessionData, type EventData, type DriftSnapshot } from '../api';

// ─── Event type config ───
const EVENT_TYPE_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  command:           { label: 'CMD',   bg: 'bg-blue-500/15',   text: 'text-blue-400' },
  file_write:        { label: 'FILE',  bg: 'bg-hawk-green/15', text: 'text-hawk-green' },
  file_delete:       { label: 'DEL',   bg: 'bg-hawk-red/15',   text: 'text-hawk-red' },
  file_read:         { label: 'READ',  bg: 'bg-hawk-text3/15', text: 'text-hawk-text3' },
  file_rename:       { label: 'REN',   bg: 'bg-hawk-amber/15', text: 'text-hawk-amber' },
  llm_call:          { label: 'LLM',   bg: 'bg-purple-500/15', text: 'text-purple-400' },
  api_call:          { label: 'API',   bg: 'bg-cyan-500/15',   text: 'text-cyan-400' },
  decision:          { label: 'DEC',   bg: 'bg-indigo-500/15', text: 'text-indigo-400' },
  guardrail_trigger: { label: 'GUARD', bg: 'bg-hawk-red/15',   text: 'text-hawk-red' },
  guardrail_block:   { label: 'BLOCK', bg: 'bg-hawk-red/15',   text: 'text-hawk-red' },
  drift_alert:       { label: 'DRIFT', bg: 'bg-hawk-amber/15', text: 'text-hawk-amber' },
  session_start:     { label: 'START', bg: 'bg-hawk-green/15', text: 'text-hawk-green' },
  session_end:       { label: 'END',   bg: 'bg-hawk-text3/15', text: 'text-hawk-text3' },
  error:             { label: 'ERR',   bg: 'bg-hawk-red/15',   text: 'text-hawk-red' },
};

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionData | null>(null);
  const [events, setEvents] = useState<EventData[]>([]);
  const [driftSnapshots, setDriftSnapshots] = useState<DriftSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // Initial fetch
    Promise.all([
      api.getSession(id),
      api.getEvents(id),
      api.getDriftSnapshots(id),
    ]).then(([s, e, d]) => {
      setSession(s);
      setEvents(e);
      setDriftSnapshots(d);
      setLoading(false);
    }).catch(() => setLoading(false));

    // Real-time via WebSocket
    const unsub = hawkeyeWs.subscribe((msg) => {
      if (msg.type === 'event' && msg.sessionId === id) {
        setEvents((prev) => {
          if (prev.some((e) => e.id === msg.event.id)) return prev;
          return [...prev, msg.event];
        });
      }
      if (msg.type === 'drift_update' && msg.sessionId === id) {
        setDriftSnapshots((prev) => [
          ...prev,
          { id: `ws-${Date.now()}`, score: msg.score, flag: msg.flag, reason: msg.reason, created_at: new Date().toISOString() },
        ]);
      }
    });

    return () => { unsub(); };
  }, [id]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    let result = events;
    if (typeFilter) {
      result = result.filter((e) => e.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const data = e.data.toLowerCase();
        return data.includes(q) || e.type.includes(q);
      });
    }
    return result;
  }, [events, typeFilter, search]);

  if (loading) return <div className="text-hawk-text3 font-mono text-sm p-8">Loading...</div>;
  if (!session) return <div className="text-hawk-red font-mono text-sm p-8">Session not found</div>;

  const duration = getDuration(session.started_at, session.ended_at);
  const isRecording = session.status === 'recording';

  // Compute event type counts
  const typeCounts: Record<string, number> = {};
  events.forEach((e) => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

  // Compute total cost from events
  const totalCost = events.reduce((sum, e) => sum + (e.cost_usd || 0), 0);

  // Find critical drift alerts
  const criticalDrifts = driftSnapshots.filter((d) => d.flag === 'critical');

  // Export as JSON
  const handleExportJSON = () => {
    const data = {
      session,
      events: events.map((e) => ({ ...e, data: JSON.parse(e.data) })),
      driftSnapshots,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hawkeye-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Back link */}
      <Link to="/" className="mb-4 inline-flex items-center gap-1 font-mono text-xs text-hawk-text3 hover:text-hawk-orange transition-colors">
        ← Sessions
      </Link>

      {/* ─── Status Bar ─── */}
      <div className="mb-6 rounded-lg border border-hawk-border bg-hawk-surface overflow-hidden">
        <div className="flex items-center gap-6 px-5 py-3 border-b border-hawk-border bg-hawk-surface2">
          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hawk-orange opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-hawk-orange"></span>
                </span>
                <span className="font-mono text-xs font-semibold text-hawk-orange">Recording</span>
              </>
            ) : session.status === 'completed' ? (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-hawk-green"></span>
                <span className="font-mono text-xs font-semibold text-hawk-green">Completed</span>
              </>
            ) : (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-hawk-red"></span>
                <span className="font-mono text-xs font-semibold text-hawk-red">Aborted</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 font-mono text-xs">
            <span className="text-hawk-text3">Actions:</span>
            <span className="text-hawk-text font-semibold">{events.length}</span>
          </div>

          <div className="flex items-center gap-1 font-mono text-xs">
            <span className="text-hawk-text3">Cost:</span>
            <span className="text-hawk-amber font-semibold">${(totalCost || session.total_cost_usd).toFixed(4)}</span>
          </div>

          {session.final_drift_score != null && (
            <div className="flex items-center gap-1 font-mono text-xs">
              <span className="text-hawk-text3">Drift:</span>
              <span className={`font-semibold ${getDriftColor(session.final_drift_score)}`}>
                {session.final_drift_score}/100
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1 font-mono text-xs">
            <span className="text-hawk-text3">Agent:</span>
            <span className="text-hawk-text font-semibold">{session.agent || 'unknown'}</span>
          </div>

          <span className="font-mono text-[10px] text-hawk-text3">{session.id.slice(0, 8)}</span>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-start justify-between mb-3">
            <h1 className="font-display text-xl font-bold text-hawk-text">{session.objective}</h1>
            <button
              onClick={handleExportJSON}
              className="shrink-0 rounded border border-hawk-border px-3 py-1.5 font-mono text-[11px] text-hawk-text3 hover:text-hawk-orange hover:border-hawk-orange/30 transition-colors"
            >
              Export JSON
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MiniStat label="Duration" value={duration} />
            <MiniStat label="LLM Calls" value={String(typeCounts['llm_call'] || 0)} highlight={(typeCounts['llm_call'] || 0) > 0} />
            <MiniStat label="Files Changed" value={String((typeCounts['file_write'] || 0) + (typeCounts['file_delete'] || 0))} />
            <MiniStat label="Commands" value={String(typeCounts['command'] || 0)} />
            <MiniStat label="Blocked" value={String(typeCounts['guardrail_trigger'] || 0)} alert={(typeCounts['guardrail_trigger'] || 0) > 0} />
          </div>
        </div>
      </div>

      {/* ─── Drift Alert Banner ─── */}
      {criticalDrifts.length > 0 && (
        <div className="mb-6 rounded-lg border border-hawk-red/30 bg-hawk-red/5 p-4">
          <div className="flex items-start gap-3">
            <span className="text-hawk-red text-lg mt-0.5">⚠</span>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-hawk-red mb-1">
                DriftDetect — Critical Divergence
              </h3>
              <p className="text-sm text-hawk-text2">{criticalDrifts[criticalDrifts.length - 1].reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drift Chart ─── */}
      {driftSnapshots.length > 0 && (
        <div className="mb-6 rounded-lg border border-hawk-border bg-hawk-surface p-5">
          <h2 className="font-display text-base font-semibold text-hawk-text mb-3">Drift Score</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={driftSnapshots.map((s, i) => ({ ...s, idx: i + 1 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E1E2A" />
              <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#5A5A6E' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#5A5A6E' }} />
              <Tooltip
                contentStyle={{ background: '#16161D', border: '1px solid #2A2A3A', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }}
                formatter={(value: number) => [`${value}/100`, 'Score']}
              />
              <ReferenceArea y1={0} y2={40} fill="#FF4757" fillOpacity={0.06} />
              <ReferenceArea y1={40} y2={70} fill="#FFB443" fillOpacity={0.06} />
              <ReferenceArea y1={70} y2={100} fill="#2ECC71" fillOpacity={0.06} />
              <Line type="monotone" dataKey="score" stroke="#FF6B2B" strokeWidth={2} dot={{ fill: '#FF6B2B', r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── Cost Breakdown + Files Changed ─── */}
      {events.length > 0 && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cost Breakdown */}
          <CostBreakdown events={events} />
          {/* Files Changed */}
          <FilesChanged events={events} onToggle={(id) => setExpandedEvent(expandedEvent === id ? null : id)} expandedEvent={expandedEvent} />
        </div>
      )}

      {/* ─── Timeline ─── */}
      <div className="rounded-lg border border-hawk-border bg-hawk-surface overflow-hidden">
        {/* Header with search + filter */}
        <div className="px-5 py-3 border-b border-hawk-border">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-display text-base font-semibold text-hawk-text">Timeline</h2>
            <span className="font-mono text-[10px] text-hawk-text3">
              {filteredEvents.length === events.length
                ? `${events.length} events`
                : `${filteredEvents.length} / ${events.length} events`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search bar */}
            <input
              type="text"
              placeholder="Search events..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 rounded bg-hawk-surface2 border border-hawk-border px-3 py-1.5 font-mono text-xs text-hawk-text placeholder-hawk-text3 outline-none focus:border-hawk-orange/50 transition-colors"
            />
            {/* Type filter badges */}
            <div className="flex items-center gap-1">
              {Object.entries(typeCounts).map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(typeFilter === type ? null : type)}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 transition-all ${
                    typeFilter === type ? 'ring-1 ring-hawk-orange' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <EventBadge type={type} />
                  <span className="font-mono text-[10px] text-hawk-text3">{count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Event list */}
        {filteredEvents.length === 0 ? (
          <div className="px-5 py-8 text-center text-hawk-text3 text-sm">
            {events.length === 0
              ? (isRecording ? 'Waiting for events...' : 'No events recorded.')
              : 'No events match your filter.'}
          </div>
        ) : (
          <div className="divide-y divide-hawk-border/50">
            {filteredEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                expanded={expandedEvent === event.id}
                onToggle={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function MiniStat({ label, value, highlight, alert }: { label: string; value: string; highlight?: boolean; alert?: boolean }) {
  return (
    <div className="rounded-md bg-hawk-surface2 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-hawk-text3">{label}</div>
      <div className={`font-mono text-sm font-semibold ${alert ? 'text-hawk-red' : highlight ? 'text-purple-400' : 'text-hawk-text'}`}>
        {value}
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const config = EVENT_TYPE_CONFIG[type] || { label: type.toUpperCase(), bg: 'bg-hawk-surface3', text: 'text-hawk-text3' };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function DriftBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-hawk-green' : score >= 40 ? 'bg-hawk-amber' : 'bg-hawk-red';
  return (
    <div className="flex items-center gap-2 w-24 shrink-0">
      <div className="flex-1 h-1.5 rounded-full bg-hawk-surface3 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <span className={`font-mono text-[10px] w-6 text-right ${getDriftColor(score)}`}>{score}</span>
    </div>
  );
}

function EventRow({ event, expanded, onToggle }: {
  event: EventData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const eventTime = new Date(event.timestamp);
  const timeStr = eventTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(event.data); } catch {}

  const { summary, detail } = getEventInfo(event.type, parsed, event);
  const hasDiff = event.type === 'file_write' && (parsed.contentBefore != null || parsed.contentAfter != null);

  const driftFlag = event.drift_flag;
  const rowBg =
    driftFlag === 'critical' ? 'bg-hawk-red/5' :
    driftFlag === 'warning' ? 'bg-hawk-amber/5' : '';

  return (
    <div className={`${rowBg} hover:bg-hawk-surface2/50 transition-colors`}>
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer" onClick={onToggle}>
        <span className="font-mono text-[10px] text-hawk-text3 w-16 shrink-0">{timeStr}</span>
        <EventBadge type={event.type} />
        <span className="text-sm text-hawk-text flex-1 min-w-0 truncate font-mono">{summary}</span>
        {event.cost_usd > 0 && (
          <span className="font-mono text-[10px] text-hawk-amber shrink-0">${event.cost_usd.toFixed(4)}</span>
        )}
        {event.drift_score != null && <DriftBar score={event.drift_score} />}
        <span className="text-hawk-text3 text-xs">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 ml-[5.5rem]">
          {/* File diff viewer */}
          {hasDiff ? (
            <FileDiff
              before={parsed.contentBefore as string | undefined}
              after={parsed.contentAfter as string | undefined}
              path={String(parsed.path || '')}
            />
          ) : detail ? (
            <div className="rounded bg-hawk-surface3/50 border border-hawk-border/50 px-3 py-2 font-mono text-xs text-hawk-text2 whitespace-pre-wrap break-all max-h-80 overflow-auto">
              {detail}
            </div>
          ) : (
            <div className="rounded bg-hawk-surface3/50 border border-hawk-border/50 px-3 py-2 font-mono text-xs text-hawk-text3">
              No additional details
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Cost Breakdown ───
function CostBreakdown({ events }: { events: EventData[] }) {
  const llmEvents = events.filter((e) => e.type === 'llm_call' && e.cost_usd > 0);
  if (llmEvents.length === 0) {
    return (
      <div className="rounded-lg border border-hawk-border bg-hawk-surface p-5">
        <h3 className="font-display text-sm font-semibold text-hawk-text mb-3">Cost Breakdown</h3>
        <p className="text-hawk-text3 text-xs font-mono">No LLM costs recorded</p>
      </div>
    );
  }

  // Group by model
  const byModel: Record<string, { cost: number; tokens: number; calls: number }> = {};
  llmEvents.forEach((e) => {
    const data = JSON.parse(e.data);
    const key = `${data.provider}/${data.model}`;
    if (!byModel[key]) byModel[key] = { cost: 0, tokens: 0, calls: 0 };
    byModel[key].cost += e.cost_usd;
    byModel[key].tokens += (data.totalTokens || 0);
    byModel[key].calls += 1;
  });

  const totalCost = Object.values(byModel).reduce((s, v) => s + v.cost, 0);
  const colors = ['#A78BFA', '#FF6B2B', '#2ECC71', '#3B82F6', '#FFB443', '#06B6D4'];

  return (
    <div className="rounded-lg border border-hawk-border bg-hawk-surface p-5">
      <h3 className="font-display text-sm font-semibold text-hawk-text mb-3">Cost Breakdown</h3>

      {/* Visual bar chart */}
      <div className="flex h-3 rounded-full overflow-hidden bg-hawk-surface3 mb-4">
        {Object.entries(byModel).map(([model, data], i) => (
          <div
            key={model}
            className="h-full transition-all"
            style={{ width: `${(data.cost / totalCost) * 100}%`, backgroundColor: colors[i % colors.length] }}
            title={`${model}: $${data.cost.toFixed(4)}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {Object.entries(byModel).map(([model, data], i) => (
          <div key={model} className="flex items-center gap-2 font-mono text-xs">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
            <span className="text-hawk-text flex-1 truncate">{model}</span>
            <span className="text-hawk-text3">{data.calls} calls</span>
            <span className="text-hawk-text3">{data.tokens.toLocaleString()} tok</span>
            <span className="text-hawk-amber font-semibold">${data.cost.toFixed(4)}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 font-mono text-xs pt-2 border-t border-hawk-border/50">
          <span className="text-hawk-text flex-1 font-semibold">Total</span>
          <span className="text-hawk-amber font-semibold">${totalCost.toFixed(4)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Files Changed ───
function FilesChanged({ events, onToggle, expandedEvent }: { events: EventData[]; onToggle: (id: string) => void; expandedEvent: string | null }) {
  const fileEvents = events.filter((e) => e.type === 'file_write' || e.type === 'file_delete');
  if (fileEvents.length === 0) {
    return (
      <div className="rounded-lg border border-hawk-border bg-hawk-surface p-5">
        <h3 className="font-display text-sm font-semibold text-hawk-text mb-3">Files Changed</h3>
        <p className="text-hawk-text3 text-xs font-mono">No file changes recorded</p>
      </div>
    );
  }

  // Deduplicate by path, keep last event
  const fileMap: Record<string, { event: EventData; data: Record<string, unknown> }> = {};
  fileEvents.forEach((e) => {
    const data = JSON.parse(e.data);
    const path = String(data.path || '');
    fileMap[path] = { event: e, data };
  });

  return (
    <div className="rounded-lg border border-hawk-border bg-hawk-surface p-5">
      <h3 className="font-display text-sm font-semibold text-hawk-text mb-3">
        Files Changed <span className="text-hawk-text3 font-normal">({Object.keys(fileMap).length})</span>
      </h3>
      <div className="space-y-1 max-h-60 overflow-auto">
        {Object.entries(fileMap).map(([path, { event, data }]) => {
          const isDelete = event.type === 'file_delete';
          return (
            <button
              key={path}
              onClick={() => onToggle(event.id)}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 font-mono text-xs hover:bg-hawk-surface2 transition-colors text-left"
            >
              <span className={`shrink-0 ${isDelete ? 'text-hawk-red' : 'text-hawk-green'}`}>
                {isDelete ? '−' : '+'}
              </span>
              <span className="text-hawk-text truncate flex-1">{shortenPath(path)}</span>
              {typeof data.sizeAfter === 'number' && (
                <span className="text-hawk-text3 shrink-0">{formatBytes(data.sizeAfter)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Visual Diff Viewer ───
function FileDiff({ before, after, path }: { before?: string; after?: string; path: string }) {
  const beforeLines = (before || '').split('\n');
  const afterLines = (after || '').split('\n');

  // Simple line diff: find added/removed/unchanged
  const diff = computeSimpleDiff(beforeLines, afterLines);
  const added = diff.filter((d) => d.type === 'add').length;
  const removed = diff.filter((d) => d.type === 'remove').length;

  return (
    <div className="rounded border border-hawk-border/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-hawk-surface3/80 border-b border-hawk-border/50">
        <span className="font-mono text-[10px] text-hawk-text2">{shortenPath(path)}</span>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          {added > 0 && <span className="text-hawk-green">+{added}</span>}
          {removed > 0 && <span className="text-hawk-red">-{removed}</span>}
        </div>
      </div>
      <div className="max-h-80 overflow-auto">
        {diff.slice(0, 200).map((line, i) => (
          <div
            key={i}
            className={`flex font-mono text-[11px] leading-5 ${
              line.type === 'add' ? 'bg-hawk-green/8 text-hawk-green' :
              line.type === 'remove' ? 'bg-hawk-red/8 text-hawk-red' :
              'text-hawk-text3'
            }`}
          >
            <span className="w-8 text-right pr-2 select-none opacity-40 shrink-0">
              {line.lineNum || ''}
            </span>
            <span className="w-4 text-center select-none opacity-60 shrink-0">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all pr-2">{line.content}</span>
          </div>
        ))}
        {diff.length > 200 && (
          <div className="px-3 py-1 font-mono text-[10px] text-hawk-text3 bg-hawk-surface3/50">
            ... {diff.length - 200} more lines
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───

function computeSimpleDiff(before: string[], after: string[]): Array<{ type: 'add' | 'remove' | 'same'; content: string; lineNum?: number }> {
  const result: Array<{ type: 'add' | 'remove' | 'same'; content: string; lineNum?: number }> = [];

  if (before.length === 0 || (before.length === 1 && before[0] === '')) {
    // New file — all lines added
    after.forEach((line, i) => result.push({ type: 'add', content: line, lineNum: i + 1 }));
    return result;
  }

  if (after.length === 0 || (after.length === 1 && after[0] === '')) {
    // Deleted file — all lines removed
    before.forEach((line, i) => result.push({ type: 'remove', content: line, lineNum: i + 1 }));
    return result;
  }

  // Simple LCS-based diff (limited to first 500 lines for performance)
  const a = before.slice(0, 500);
  const b = after.slice(0, 500);
  const aSet = new Set(a);
  const bSet = new Set(b);

  let ai = 0, bi = 0, lineNum = 0;
  while (ai < a.length || bi < b.length) {
    if (ai < a.length && bi < b.length && a[ai] === b[bi]) {
      lineNum++;
      result.push({ type: 'same', content: a[ai], lineNum });
      ai++; bi++;
    } else if (bi < b.length && !aSet.has(b[bi])) {
      lineNum++;
      result.push({ type: 'add', content: b[bi], lineNum });
      bi++;
    } else if (ai < a.length && !bSet.has(a[ai])) {
      result.push({ type: 'remove', content: a[ai] });
      ai++;
    } else if (ai < a.length) {
      result.push({ type: 'remove', content: a[ai] });
      ai++;
    } else {
      lineNum++;
      result.push({ type: 'add', content: b[bi], lineNum });
      bi++;
    }
  }

  return result;
}

function getEventInfo(type: string, parsed: Record<string, unknown>, event: EventData): { summary: string; detail?: string } {
  switch (type) {
    case 'command': {
      const cmd = `${parsed.command || ''} ${((parsed.args as string[]) || []).join(' ')}`.trim();
      const exit = parsed.exitCode != null && parsed.exitCode !== 0 ? ` → exit ${parsed.exitCode}` : '';
      const detail = parsed.stdout || parsed.stderr
        ? `${parsed.stdout ? String(parsed.stdout).slice(0, 1000) : ''}${parsed.stderr ? '\n' + String(parsed.stderr).slice(0, 1000) : ''}`.trim()
        : undefined;
      return { summary: cmd + exit, detail };
    }
    case 'file_write': {
      const path = String(parsed.path || '');
      const size = parsed.sizeAfter ? ` (${formatBytes(parsed.sizeAfter as number)})` : '';
      return { summary: `Modified ${shortenPath(path)}${size}` };
    }
    case 'file_delete':
      return { summary: `Deleted ${shortenPath(String(parsed.path || ''))}` };
    case 'file_read':
      return { summary: `Read ${shortenPath(String(parsed.path || ''))}` };
    case 'llm_call': {
      const model = String(parsed.model || 'unknown');
      const tokens = Number(parsed.totalTokens || 0);
      const cost = event.cost_usd > 0 ? ` ($${event.cost_usd.toFixed(4)})` : '';
      const provider = String(parsed.provider || '');
      const detail = parsed.prompt
        ? `Prompt: ${String(parsed.prompt).slice(0, 800)}${parsed.response ? '\n\nResponse: ' + String(parsed.response).slice(0, 800) : ''}`
        : `${provider}/${model} — ${tokens.toLocaleString()} tokens`;
      return { summary: `${provider}/${model} → ${tokens.toLocaleString()} tokens${cost}`, detail };
    }
    case 'api_call': {
      const method = String(parsed.method || 'GET');
      const url = String(parsed.url || '');
      const status = parsed.statusCode ? ` → ${parsed.statusCode}` : '';
      return { summary: `${method} ${url}${status}` };
    }
    case 'guardrail_trigger':
    case 'guardrail_block': {
      const desc = String(parsed.description || parsed.blockedAction || 'Guardrail triggered');
      const rule = parsed.ruleName ? `[${parsed.ruleName}] ` : '';
      return { summary: `${rule}${desc}`, detail: parsed.blockedAction ? String(parsed.blockedAction) : undefined };
    }
    case 'drift_alert': {
      const score = parsed.score != null ? `Score: ${parsed.score}` : '';
      const reason = String(parsed.reason || '');
      return { summary: `${score} — ${reason}`, detail: parsed.suggestion ? String(parsed.suggestion) : undefined };
    }
    case 'decision': {
      const desc = String(parsed.description || '');
      const detail = parsed.reasoning ? String(parsed.reasoning) : undefined;
      return { summary: desc, detail };
    }
    case 'session_start':
      return { summary: 'Session started' };
    case 'session_end': {
      const desc = String(parsed.description || 'Session ended');
      return { summary: desc, detail: parsed.reasoning ? String(parsed.reasoning) : undefined };
    }
    case 'file_rename':
      return { summary: `Renamed ${shortenPath(String(parsed.oldPath || ''))} → ${shortenPath(String(parsed.path || ''))}` };
    case 'error':
      return { summary: String(parsed.description || parsed.message || 'Error') };
    default:
      return { summary: type };
  }
}

function getDriftColor(score: number | null): string {
  if (score == null) return 'text-hawk-text3';
  if (score >= 70) return 'text-hawk-green';
  if (score >= 40) return 'text-hawk-amber';
  return 'text-hawk-red';
}

function getDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function shortenPath(p: string): string {
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return '…/' + parts.slice(-3).join('/');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
