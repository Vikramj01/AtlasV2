'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EMQBreakdownRow {
  event_name: string;
  score: number;
  sample_size: number;
}

interface EMQEstimatorProps {
  score: number | null;
  breakdown?: EMQBreakdownRow[];
  recommendations?: string[];
  isLoading?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 7) return 'text-[#059669]';
  if (score >= 5) return 'text-[#D97706]';
  return 'text-[#DC2626]';
}

function thumbPosition(score: number): number {
  // Clamp 0-10 → 0-100%
  return Math.min(Math.max((score / 10) * 100, 0), 100);
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const colorClass = scoreColor(score);
  const thumbPct = thumbPosition(score);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Large numeric score */}
      <div className="flex items-baseline gap-1.5">
        <span className={`text-6xl font-bold tabular-nums ${colorClass}`}>
          {score.toFixed(1)}
        </span>
        <span className="text-xl text-muted-foreground font-medium">/ 10</span>
      </div>

      {/* Gradient bar with thumb */}
      <div className="relative w-full max-w-xs">
        <div
          className="h-3 w-full rounded-full"
          style={{
            background: 'linear-gradient(to right, #ef4444, #f59e0b, #22c55e)',
          }}
        />
        {/* Thumb indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md bg-white ring-1 ring-black/10"
          style={{ left: `${thumbPct}%` }}
        />
        {/* Range labels */}
        <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>
      </div>

      {/* Interpretation label */}
      <p className={`text-sm font-medium ${colorClass}`}>
        {score >= 7
          ? 'Good — high match quality'
          : score >= 5
          ? 'Fair — room for improvement'
          : 'Poor — significant data gaps'}
      </p>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: EMQBreakdownRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left pb-2 font-medium">Event</th>
            <th className="text-right pb-2 font-medium w-20">Score</th>
            <th className="text-right pb-2 font-medium w-28">Sample Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.event_name} className="border-b last:border-0">
              <td className="py-2.5 font-mono text-xs">{row.event_name}</td>
              <td className={`py-2.5 text-right tabular-nums font-semibold ${scoreColor(row.score)}`}>
                {row.score.toFixed(1)}
              </td>
              <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                {row.sample_size.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function EMQEstimator({
  score,
  breakdown,
  recommendations,
  isLoading = false,
}: EMQEstimatorProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-section-header">Match quality</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-6">
        {/* Score gauge */}
        {isLoading || score === null ? (
          <div className="flex flex-col items-center gap-4">
            <SkeletonBlock className="h-14 w-32" />
            <SkeletonBlock className="h-3 w-64 max-w-xs" />
            <SkeletonBlock className="h-4 w-40" />
          </div>
        ) : (
          <ScoreGauge score={score} />
        )}

        {/* Per-event breakdown */}
        {!isLoading && breakdown && breakdown.length > 0 && (
          <div>
            <p className="text-caption-upper mb-3">
              Per-Event Breakdown
            </p>
            <BreakdownTable rows={breakdown} />
          </div>
        )}

        {/* Recommendations */}
        {!isLoading && recommendations && recommendations.length > 0 && (
          <div>
            <p className="text-caption-upper mb-2">
              Recommendations
            </p>
            <ul className="space-y-1.5">
              {recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
