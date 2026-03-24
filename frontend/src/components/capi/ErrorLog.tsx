'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ErrorLogEntry {
  event_name: string;
  error_code: string;
  error_message: string | null;
  count: number;
  last_seen: string;
}

interface ErrorLogProps {
  errors: ErrorLogEntry[];
  isLoading?: boolean;
  onDismiss?: (errorCode: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLastSeen(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorCodeBadgeClass(errorCode: string): string {
  if (errorCode === 'CONSENT_BLOCKED') {
    return 'bg-amber-100 text-amber-800 border-amber-200';
  }
  return 'bg-red-100 text-red-800 border-red-200';
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCell({ className }: { className?: string }) {
  return (
    <td className="px-3 py-3">
      <div className={`animate-pulse rounded bg-muted ${className ?? 'h-3.5 w-full'}`} />
    </td>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b last:border-0">
      <SkeletonCell className="h-3.5 w-24" />
      <SkeletonCell className="h-5 w-32" />
      <SkeletonCell className="h-3.5 w-48" />
      <SkeletonCell className="h-3.5 w-10" />
      <SkeletonCell className="h-3.5 w-28" />
      <td className="px-3 py-3">
        <div className="animate-pulse rounded bg-muted h-7 w-7" />
      </td>
    </tr>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {/* Checkmark icon (inline SVG, no external lib) */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8 text-green-500"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <p className="text-sm font-medium text-green-700">No errors in the selected period.</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ErrorLog({
  errors,
  isLoading = false,
  onDismiss,
}: ErrorLogProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Error Log</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 px-3 font-medium">Event</th>
                  <th className="text-left pb-2 px-3 font-medium">Error Code</th>
                  <th className="text-left pb-2 px-3 font-medium">Message</th>
                  <th className="text-right pb-2 px-3 font-medium w-16">Count</th>
                  <th className="text-left pb-2 px-3 font-medium w-36">Last Seen</th>
                  <th className="pb-2 px-3 w-10" />
                </tr>
              </thead>
              <tbody>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </tbody>
            </table>
          </div>
        ) : errors.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left pb-2 px-3 font-medium">Event</th>
                  <th className="text-left pb-2 px-3 font-medium">Error Code</th>
                  <th className="text-left pb-2 px-3 font-medium">Message</th>
                  <th className="text-right pb-2 px-3 font-medium w-16">Count</th>
                  <th className="text-left pb-2 px-3 font-medium w-36">Last Seen</th>
                  <th className="pb-2 px-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {errors.map((entry) => (
                  <tr key={`${entry.event_name}-${entry.error_code}`} className="border-b last:border-0">
                    {/* Event name */}
                    <td className="py-3 px-3">
                      <span className="font-mono text-xs">{entry.event_name}</span>
                    </td>

                    {/* Error code badge */}
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block font-mono text-xs px-2 py-0.5 rounded border ${errorCodeBadgeClass(entry.error_code)}`}
                      >
                        {entry.error_code}
                      </span>
                    </td>

                    {/* Message */}
                    <td className="py-3 px-3 text-muted-foreground max-w-xs truncate">
                      {entry.error_message ?? <span className="italic text-muted-foreground/50">—</span>}
                    </td>

                    {/* Count */}
                    <td className="py-3 px-3 text-right tabular-nums font-medium">
                      {entry.count.toLocaleString()}
                    </td>

                    {/* Last seen */}
                    <td className="py-3 px-3 text-muted-foreground text-xs whitespace-nowrap">
                      {formatLastSeen(entry.last_seen)}
                    </td>

                    {/* Dismiss */}
                    <td className="py-3 px-3">
                      {onDismiss && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => onDismiss(entry.error_code)}
                          aria-label={`Dismiss ${entry.error_code}`}
                        >
                          ×
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
