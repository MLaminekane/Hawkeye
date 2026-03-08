interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<string, { color: string; label: string }> = {
    completed: { color: 'text-hawk-green', label: '✓' },
    recording: { color: 'text-hawk-amber', label: '●' },
    aborted: { color: 'text-hawk-red', label: '✗' },
  };

  const { color, label } = config[status] ?? { color: 'text-hawk-text3', label: '?' };

  return <span className={`font-mono text-xs ${color}`}>{label} {status}</span>;
}
