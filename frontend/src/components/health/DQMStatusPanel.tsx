// DQM Status Panel — shows live GTG probe + DMA diagnostics in the health dashboard

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

interface GTGCheck {
  check_status: 'pass' | 'degraded' | 'fail' | 'timeout' | 'error';
  http_status: number | null;
  response_ms: number | null;
  error_message: string | null;
  checked_at: string;
}

interface DMAState {
  upload_success_rate: number;
  avg_match_rate: number | null;
  total_members_30d: number;
  destination_count: number;
  last_successful_at: string | null;
  last_polled_at: string | null;
  consecutive_failures: number;
  backoff_until: string | null;
  is_in_backoff: boolean;
}

interface DQMStatus {
  gtg: { recent_checks: GTGCheck[]; latest_status: string };
  dma: DMAState | null;
}

const STATUS_DOT: Record<string, string> = {
  pass:     'bg-emerald-500',
  degraded: 'bg-amber-400',
  fail:     'bg-red-500',
  timeout:  'bg-red-500',
  error:    'bg-gray-400',
  unknown:  'bg-gray-300',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn('inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 mt-0.5', STATUS_DOT[status] ?? 'bg-gray-300')} />
  );
}

function formatBackoffTime(backoffUntil: string): string {
  const d = new Date(backoffUntil);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function gtgDescription(check: GTGCheck): string {
  if (check.check_status === 'pass') {
    return `Responding — ${check.response_ms}ms`;
  }
  if (check.check_status === 'degraded') {
    return `Slow response — ${check.response_ms}ms (above 2s threshold)`;
  }
  return check.error_message ?? check.check_status;
}

export function DQMStatusPanel() {
  const [data, setData] = useState<DQMStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setLoading(false); return; }
      return fetch('/api/dqm/status', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(r => r.ok ? r.json() as Promise<{ data: DQMStatus }> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(body => setData(body.data))
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4 animate-pulse">
        <div className="h-4 w-40 rounded bg-gray-200 mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-gray-200" />
          <div className="h-3 w-3/4 rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const gtgStatus = data.gtg.latest_status;
  const latestCheck = data.gtg.recent_checks[0];
  const dma = data.dma;

  const dmaStatus = dma
    ? dma.is_in_backoff
      ? 'error'
      : dma.total_members_30d > 0
        ? 'pass'
        : 'unknown'
    : 'unknown';

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-4">
      <h3 className="text-sm font-semibold text-[#1B2A4A]">Data Quality Monitor</h3>

      {/* GTG probe row */}
      <div className="flex items-start gap-3">
        <StatusDot status={gtgStatus} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Google Tag Gateway path</p>
            {gtgStatus === 'degraded' && (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">
                Degraded
              </span>
            )}
          </div>
          {latestCheck ? (
            <p className="text-xs text-muted-foreground">
              {gtgDescription(latestCheck)}
              {' · '}Last checked {new Date(latestCheck.checked_at).toLocaleTimeString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No check run yet</p>
          )}
          {gtgStatus === 'degraded' && (
            <p className="text-xs text-amber-600 mt-0.5">
              Response time is above the 2s threshold. Server-side performance may be impacted.
            </p>
          )}
        </div>
      </div>

      {/* DMA state row */}
      <div className="flex items-start gap-3">
        <StatusDot status={dmaStatus} />
        <div className="min-w-0">
          <p className="text-sm font-medium">DMA diagnostics (30d)</p>
          {dma ? (
            <>
              {dma.is_in_backoff ? (
                <p className="text-xs text-muted-foreground">
                  Polling paused — retrying at {formatBackoffTime(dma.backoff_until!)}
                  {dma.consecutive_failures > 1 && ` (${dma.consecutive_failures} consecutive failures)`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {dma.total_members_30d.toLocaleString()} members ·{' '}
                  {dma.avg_match_rate !== null ? `${dma.avg_match_rate.toFixed(0)}% match rate · ` : 'No match data · '}
                  {dma.upload_success_rate}% upload success
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No DMA activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
