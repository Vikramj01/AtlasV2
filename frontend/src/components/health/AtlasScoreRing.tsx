interface AtlasScoreRingProps {
  overall: number;
  foundation: number;
  signal_quality: number;
  channel_performance: number;
  updated_at: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#059669';
  if (score >= 60) return '#D97706';
  return '#DC2626';
}

const NAVY = '#1B2A4A';
const NAVY_LIGHT = '#EEF1F7';

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = scoreColor(value);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-[#6B7280]">{label}</span>
        <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[#EEF1F7]">
        <div
          className="h-1.5 rounded-full transition-all duration-700"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function AtlasScoreRing({
  overall,
  foundation,
  signal_quality,
  channel_performance,
  updated_at,
}: AtlasScoreRingProps) {
  const SIZE = 180;
  const STROKE = 10;
  const RADIUS = (SIZE - STROKE) / 2;
  const CX = SIZE / 2;
  const circumference = 2 * Math.PI * RADIUS;
  const dashOffset = circumference - (Math.max(0, Math.min(100, overall)) / 100) * circumference;

  const color = scoreColor(overall);

  const formattedAt = new Date(updated_at).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
      {/* Ring */}
      <div className="flex flex-col items-center gap-3 shrink-0">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <circle cx={CX} cy={CX} r={RADIUS} fill="none" stroke={NAVY_LIGHT} strokeWidth={STROKE} />
            <circle
              cx={CX} cy={CX} r={RADIUS}
              fill="none"
              stroke={NAVY}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${CX} ${CX})`}
              style={{ transition: 'stroke-dashoffset 0.7s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-[36px] font-semibold leading-none tabular-nums" style={{ color }}>
              {overall}
            </span>
            <span className="text-xs text-[#6B7280] font-medium">/ 100</span>
          </div>
        </div>
        <p className="text-[10px] text-[#9CA3AF]">Updated {formattedAt}</p>
      </div>

      {/* Sub-score bars */}
      <div className="flex-1 space-y-4 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">Sub-scores</p>
        <ScoreBar label="Foundation" value={foundation} />
        <ScoreBar label="Signal quality" value={signal_quality} />
        <ScoreBar label="Channel performance" value={channel_performance} />
      </div>
    </div>
  );
}
