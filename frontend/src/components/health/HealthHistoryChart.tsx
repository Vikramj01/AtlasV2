/**
 * HealthHistoryChart — SVG sparkline showing overall_score over time.
 * No external charting library required.
 */

import type { HealthSnapshot } from '@/types/health';

interface HealthHistoryChartProps {
  snapshots: HealthSnapshot[];
}

const CHART_H = 80;
const CHART_W = 600; // viewBox width, scales with container

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

export function HealthHistoryChart({ snapshots }: HealthHistoryChartProps) {
  if (snapshots.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
        Not enough data yet — check back after a few computation cycles.
      </div>
    );
  }

  // Build SVG polyline points
  const n = snapshots.length;
  const scores = snapshots.map((s) => s.overall_score);
  const minScore = Math.max(0, Math.min(...scores) - 5);
  const maxScore = Math.min(100, Math.max(...scores) + 5);
  const range = maxScore - minScore || 1;

  const points = snapshots.map((s, i) => {
    const x = (i / (n - 1)) * CHART_W;
    const y = CHART_H - ((s.overall_score - minScore) / range) * CHART_H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const latestScore = scores[scores.length - 1];
  const earliestDate = new Date(snapshots[0].snapshot_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const latestDate   = new Date(snapshots[n - 1].snapshot_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  // Fill path (area under curve)
  const lastX = CHART_W.toFixed(1);
  const fillPath = `M 0,${CHART_H} L ${points.join(' L ')} L ${lastX},${CHART_H} Z`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: CHART_H }}
      >
        <defs>
          <linearGradient id="healthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={scoreColor(latestScore)} stopOpacity="0.2" />
            <stop offset="100%" stopColor={scoreColor(latestScore)} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={fillPath} fill="url(#healthFill)" />

        {/* Line */}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={scoreColor(latestScore)}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Latest point dot */}
        {(() => {
          const last = points[points.length - 1].split(',');
          return (
            <circle
              cx={last[0]} cy={last[1]} r="4"
              fill={scoreColor(latestScore)}
              stroke="white"
              strokeWidth="2"
            />
          );
        })()}
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        <span>{earliestDate}</span>
        <span>{latestDate}</span>
      </div>
    </div>
  );
}
