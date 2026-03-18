/**
 * OverallScoreRing — circular progress ring showing the overall health score.
 * SVG-based, no external charting library needed.
 */

interface OverallScoreRingProps {
  score: number; // 0–100
  computedAt: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'; // green-500
  if (score >= 60) return '#f59e0b'; // amber-500
  if (score >= 40) return '#f97316'; // orange-500
  return '#ef4444';                  // red-500
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Healthy';
  if (score >= 60) return 'Needs attention';
  if (score >= 40) return 'At risk';
  return 'Critical';
}

export function OverallScoreRing({ score, computedAt }: OverallScoreRingProps) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;
  const color = scoreColor(score);
  const label = scoreLabel(score);

  const formattedAt = new Date(computedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="140" height="140" viewBox="0 0 140 140">
          {/* Background track */}
          <circle
            cx="70" cy="70" r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            className="text-muted/20"
          />
          {/* Progress arc */}
          <circle
            cx="70" cy="70" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        {/* Score text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums" style={{ color }}>
            {score}
          </span>
          <span className="text-xs text-muted-foreground font-medium">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color }}>{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Updated {formattedAt}</p>
      </div>
    </div>
  );
}
