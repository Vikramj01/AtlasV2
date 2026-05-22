// DQM Status Panel — shows live GTG probe + DMA diagnostics in the health dashboard

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

interface GTGCheck {
  check_status: 'pass' | 'fail' | 'timeout' | 'error';
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
}

interface DQMStatus {
  gtg: { recent_checks: GTGCheck[]; latest_status: string };
  dma: DMAState | null;
}

const STATUS_DOT: Record<string, string> = {
  pass:    'bg-emerald-500',
  fail:    'bg-red-500',
  timeout: 'bg-amber-500',
  error:   'bg-gray-400',
  unknown: 'bg-gray-300',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn('inline-block h-2.5 w-2.5 rounded-full flex-shrink-0', STATUS_DOT[status] ?? 'bg-gray-300')} />
  );
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
        .then(r => r.ok ? r.json() as Promise<DQMStatus> : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(setData)
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

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-4">
      <h3 className="text-sm font-semibold text-[#1B2A4A]">Data Quality Monitor</h3>

      {/* GTG probe row */}
      <div className="flex items-start gap-3">
        <StatusDot status={gtgStatus} />
        <div className="min-w-0">
          <p className="text-sm font-medium">Google Tag Gateway path</p>
          {latestCheck ? (
            <p className="text-xs text-muted-foreground">
              {latestCheck.check_status === 'pass'
                ? `Responding — ${latestCheck.response_ms}ms`
                : latestCheck.error_message ?? latestCheck.check_status}
              {' · '}Last checked {new Date(latestCheck.checked_at).toLocaleTimeString()}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No check run yet</p>
          )}
        </div>
      </div>

      {/* DMA state row */}
      <div className="flex items-start gap-3">
        <StatusDot status={dma && dma.total_members_30d > 0 ? 'pass' : 'unknown'} />
        <div className="min-w-0">
          <p className="text-sm font-medium">DMA diagnostics (30d)</p>
          {dma ? (
            <p className="text-xs text-muted-foreground">
              {dma.total_members_30d.toLocaleString()} members ·{' '}
              {dma.avg_match_rate !== null ? `${dma.avg_match_rate.toFixed(0)}% match rate · ` : 'No match data · '}
              {dma.upload_success_rate}% upload success
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No DMA activity yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
