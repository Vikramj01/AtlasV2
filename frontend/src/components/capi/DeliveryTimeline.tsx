'use client';

import { Card, CardContent } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayRecord {
  date: string;
  delivered: number;
  failed: number;
}

interface DeliveryTimelineProps {
  byDay: DayRecord[];
  isLoading?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type DotStatus = 'green' | 'amber' | 'red' | 'grey';

function dotStatus(delivered: number, failed: number): DotStatus {
  const total = delivered + failed;
  if (total === 0) return 'grey';
  if (failed === 0) return 'green';
  if (delivered === 0) return 'red';
  return 'amber';
}

const DOT_CLASSES: Record<DotStatus, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red:   'bg-red-500',
  grey:  'bg-muted-foreground/30',
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <li className="flex items-center gap-4 py-3 border-b last:border-0">
      <div className="animate-pulse rounded-full bg-muted h-2.5 w-2.5 shrink-0" />
      <div className="animate-pulse rounded bg-muted h-3.5 w-16 shrink-0" />
      <div className="flex-1 flex justify-end gap-6">
        <div className="animate-pulse rounded bg-muted h-3.5 w-20" />
        <div className="animate-pulse rounded bg-muted h-3.5 w-16" />
      </div>
    </li>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function DeliveryTimeline({
  byDay,
  isLoading = false,
}: DeliveryTimelineProps) {
  const days = byDay.slice(-14);

  return (
    <Card>
      <CardContent className="pt-4">
        {isLoading ? (
          <ul>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </ul>
        ) : days.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No delivery data available yet.
          </p>
        ) : (
          <ul>
            {days.map((day) => {
              const status = dotStatus(day.delivered, day.failed);
              return (
                <li
                  key={day.date}
                  className="flex items-center gap-4 py-3 border-b last:border-0"
                >
                  {/* Status dot */}
                  <span
                    className={`shrink-0 h-2.5 w-2.5 rounded-full ${DOT_CLASSES[status]}`}
                    aria-label={status}
                  />

                  {/* Date */}
                  <span className="shrink-0 w-14 text-sm text-muted-foreground">
                    {formatDate(day.date)}
                  </span>

                  {/* Spacer */}
                  <span className="flex-1" />

                  {/* Delivered */}
                  <span className="text-sm font-medium text-green-600 tabular-nums w-28 text-right">
                    {day.delivered.toLocaleString()} delivered
                  </span>

                  {/* Failed */}
                  <span
                    className={`text-sm font-medium tabular-nums w-20 text-right ${
                      day.failed > 0 ? 'text-red-600' : 'text-muted-foreground/50'
                    }`}
                  >
                    {day.failed.toLocaleString()} failed
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
