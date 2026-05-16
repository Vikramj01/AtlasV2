import type { ReconciliationFinding } from '@/lib/api/reconciliationApi';

const SEVERITY_PENALTIES: Record<ReconciliationFinding['severity'], number> = {
  critical: 25,
  error:    15,
  warning:  5,
  info:     1,
};

const DIMENSIONS: { key: ReconciliationFinding['dimension']; label: string }[] = [
  { key: 'delivery',  label: 'Delivery' },
  { key: 'config',    label: 'Config' },
  { key: 'alignment', label: 'Alignment' },
  { key: 'volume',    label: 'Volume' },
];

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-amber-400';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  if (score >= 80) return 'text-green-700';
  if (score >= 60) return 'text-amber-700';
  return 'text-red-700';
}

interface Props {
  findings: ReconciliationFinding[];
}

export function DimensionScorePanel({ findings }: Props) {
  const openFindings = findings.filter((f) => f.resolved_at === null);

  const scores = DIMENSIONS.map(({ key, label }) => {
    const dimFindings = openFindings.filter((f) => f.dimension === key);
    const penalty = dimFindings.reduce((sum, f) => sum + SEVERITY_PENALTIES[f.severity], 0);
    const score = Math.max(0, 100 - penalty);
    return { key, label, score, count: dimFindings.length };
  });

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Dimension scores</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {scores.map(({ key, label, score, count }) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-[#6B7280] font-medium">{label}</span>
              <span className={`text-sm font-bold tabular-nums ${scoreTextColor(score)}`}>{score}</span>
            </div>
            {/* Bar */}
            <div className="h-1.5 w-full rounded-full bg-[#E5E7EB] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${scoreColor(score)}`}
                style={{ width: `${score}%` }}
              />
            </div>
            <p className="text-[10px] text-[#9CA3AF]">
              {count === 0 ? 'No open findings' : `${count} open finding${count === 1 ? '' : 's'}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
