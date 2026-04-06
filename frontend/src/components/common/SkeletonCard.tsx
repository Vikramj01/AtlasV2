/**
 * SkeletonCard — shimmer loading placeholders.
 *
 * Design spec: "Loading: Use Skeleton shimmer (Tailwind animate-pulse or similar)."
 *
 * Variants:
 *   metric    — 4-cell metric bar cell (used in SummaryBar)
 *   card      — standard content card (used for action cards, signal cards, etc.)
 *   row       — table row (used in data tables)
 *   chart     — chart placeholder (used in dashboards)
 *   list      — multi-row list (renders `count` rows)
 *   page      — full page skeleton (title + 3 cards)
 *
 * Usage:
 *   <SkeletonCard variant="metric" />
 *   <SkeletonCard variant="list" count={5} />
 *   <SkeletonCard variant="page" />
 */

import { cn } from '@/lib/utils';

// ── Base shimmer block ────────────────────────────────────────────────────────

function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded bg-gray-100 animate-pulse',
        className,
      )}
    />
  );
}

// ── Variants ──────────────────────────────────────────────────────────────────

function MetricSkeleton() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-4 flex flex-col gap-2">
      <Shimmer className="h-3 w-20" />    {/* label */}
      <Shimmer className="h-7 w-14" />    {/* value */}
      <Shimmer className="h-3 w-16" />    {/* sub-label */}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] border-l-[3px] border-l-gray-200 bg-white px-4 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Shimmer className="h-4 w-4 rounded-full" />  {/* icon */}
        <Shimmer className="h-4 w-40" />               {/* title */}
      </div>
      <Shimmer className="h-3 w-full" />
      <Shimmer className="h-3 w-3/4" />
      <div className="flex items-center gap-2 mt-1">
        <Shimmer className="h-6 w-20 rounded-full" />  {/* badge */}
        <Shimmer className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

function RowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 border-b border-[#E5E7EB]',
        index % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]',
      )}
    >
      <Shimmer className="h-3 w-3/12" />
      <Shimmer className="h-3 w-2/12" />
      <Shimmer className="h-3 w-3/12" />
      <Shimmer className="h-3 w-1/12" />
      <Shimmer className="h-6 w-16 rounded-full ml-auto" />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-4">
      <div className="flex items-center justify-between mb-4">
        <Shimmer className="h-4 w-32" />   {/* title */}
        <Shimmer className="h-6 w-20" />   {/* period selector */}
      </div>
      {/* Chart area */}
      <div className="flex items-end gap-1 h-32">
        {[60, 80, 45, 90, 70, 55, 85, 40, 75, 65, 95, 50].map((h, i) => (
          <Shimmer
            key={i}
            style={{ height: `${h}%` }}
            className="flex-1 rounded-t"
          />
        ))}
      </div>
      {/* X-axis labels */}
      <div className="flex gap-1 mt-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Shimmer key={i} className="flex-1 h-2" />
        ))}
      </div>
    </div>
  );
}

function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-[#F9FAFB] border-b border-[#E5E7EB]">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-20" />
        <Shimmer className="h-3 w-28" />
      </div>
      {/* Rows */}
      {Array.from({ length: count }).map((_, i) => (
        <RowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page title + action */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <Shimmer className="h-6 w-48" />   {/* page title */}
          <Shimmer className="h-3 w-72" />   {/* description */}
        </div>
        <Shimmer className="h-9 w-28 rounded-md" />  {/* CTA button */}
      </div>

      {/* Metric bar — 4 cells */}
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <MetricSkeleton key={i} />)}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>

      {/* Table */}
      <ListSkeleton count={3} />
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type SkeletonVariant = 'metric' | 'card' | 'row' | 'chart' | 'list' | 'page';

interface SkeletonCardProps {
  variant?: SkeletonVariant;
  /** Number of rows/items (used by 'list' and 'row' variants) */
  count?: number;
  className?: string;
}

export function SkeletonCard({
  variant = 'card',
  count = 4,
  className,
}: SkeletonCardProps) {
  const inner = (() => {
    switch (variant) {
      case 'metric': return <MetricSkeleton />;
      case 'row':    return <RowSkeleton />;
      case 'chart':  return <ChartSkeleton />;
      case 'list':   return <ListSkeleton count={count} />;
      case 'page':   return <PageSkeleton />;
      default:       return <CardSkeleton />;
    }
  })();

  return <div className={cn(className)}>{inner}</div>;
}

// ── Named exports for convenience ─────────────────────────────────────────────
export { MetricSkeleton, CardSkeleton, RowSkeleton, ChartSkeleton, ListSkeleton, PageSkeleton };
