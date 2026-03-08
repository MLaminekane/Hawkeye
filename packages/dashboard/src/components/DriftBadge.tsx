interface DriftBadgeProps {
  score: number | null;
  size?: 'sm' | 'md';
}

export function DriftBadge({ score, size = 'sm' }: DriftBadgeProps) {
  if (score == null) return null;

  const color =
    score >= 70
      ? 'bg-hawk-green/15 text-hawk-green border-hawk-green/30'
      : score >= 40
        ? 'bg-hawk-amber/15 text-hawk-amber border-hawk-amber/30'
        : 'bg-hawk-red/15 text-hawk-red border-hawk-red/30';

  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';

  return (
    <span className={`inline-flex items-center rounded border font-mono font-medium ${color} ${sizeClass}`}>
      {score.toFixed(0)}
    </span>
  );
}
