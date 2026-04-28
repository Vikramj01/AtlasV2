import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api/adminApi';
import type { ReconciliationSnapshot } from '@/types/usage';

function fmtMins(n: number) {
  return n.toFixed(1);
}

function fmtPct(delta: number, total: number): string {
  if (total === 0) return '0%';
  return `${((delta / total) * 100).toFixed(1)}%`;
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function GapBadge({ deltaPct }: { deltaPct: number }) {
  if (deltaPct > 0.10) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Gap {(deltaPct * 100).toFixed(1)}% — check Browserbase
      </span>
    );
  }
  if (deltaPct > 0.03) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Gap {(deltaPct * 100).toFixed(1)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Attributed
    </span>
  );
}

export function BbReconciliationPanel() {
  const [snapshots, setSnapshots] = useState<ReconciliationSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    adminApi.getReconciliation(14)
      .then((res) => setSnapshots(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const latest = snapshots[0] ?? null;
  const deltaPct = latest && latest.total_browser_minutes > 0
    ? latest.delta_minutes / latest.total_browser_minutes
    : 0;

  return (
    <div className="rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">Browserbase reconciliation</span>
          {latest && <GapBadge deltaPct={deltaPct} />}
        </div>
        {latest && (
          <span className="text-xs text-muted-foreground">
            Last snapshot: {fmtDate(latest.snapshot_date)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          Loading…
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-8 text-sm text-red-500">
          Failed to load reconciliation data.
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No snapshots yet — the nightly job runs at 02:00 UTC.
        </div>
      ) : (
        <div className="p-5 space-y-5">
          {/* Current period summary */}
          {latest && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Billed (Browserbase)"
                value={`${fmtMins(latest.total_browser_minutes)} min`}
              />
              <Stat
                label="Attributed (Atlas)"
                value={`${fmtMins(latest.atlas_logged_minutes ?? 0)} min`}
              />
              <Stat
                label="Unattributed delta"
                value={`${fmtMins(latest.delta_minutes)} min`}
                sub={fmtPct(latest.delta_minutes, latest.total_browser_minutes)}
                highlight={deltaPct > 0.10 ? 'red' : deltaPct > 0.03 ? 'amber' : undefined}
              />
              <Stat
                label="Overage cost MTD"
                value={latest.overage_minutes > 0 ? `$${latest.overage_cost_usd.toFixed(4)}` : '$0'}
                sub={latest.overage_minutes > 0 ? `${fmtMins(latest.overage_minutes)} min over` : `${fmtMins(latest.included_minutes - latest.total_browser_minutes)} min remaining`}
                highlight={latest.overage_minutes > 0 ? 'amber' : undefined}
              />
            </div>
          )}

          {/* Snapshot history */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Last {snapshots.length} daily snapshots
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-[#F9FAFB] text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium text-right">Billed (min)</th>
                    <th className="px-3 py-2 font-medium text-right">Atlas (min)</th>
                    <th className="px-3 py-2 font-medium text-right">Delta (min)</th>
                    <th className="px-3 py-2 font-medium text-right">Delta %</th>
                    <th className="px-3 py-2 font-medium text-right">Overage $</th>
                    <th className="px-3 py-2 font-medium text-right">Proxy (GB)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {snapshots.map((s) => {
                    const dp = s.total_browser_minutes > 0
                      ? s.delta_minutes / s.total_browser_minutes
                      : 0;
                    return (
                      <tr key={s.snapshot_date} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 font-medium text-foreground whitespace-nowrap">
                          {fmtDate(s.snapshot_date)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {fmtMins(s.total_browser_minutes)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {s.atlas_logged_minutes !== null ? fmtMins(s.atlas_logged_minutes) : '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${dp > 0.10 ? 'text-red-600 font-semibold' : dp > 0.03 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {fmtMins(s.delta_minutes)}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${dp > 0.10 ? 'text-red-600 font-semibold' : dp > 0.03 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {fmtPct(s.delta_minutes, s.total_browser_minutes)}
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${s.overage_cost_usd > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {s.overage_cost_usd > 0 ? `$${s.overage_cost_usd.toFixed(4)}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {s.total_proxy_data_gb.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'red' | 'amber';
}) {
  const valueColor = highlight === 'red'
    ? 'text-red-600'
    : highlight === 'amber'
      ? 'text-amber-600'
      : 'text-foreground';

  return (
    <div className="rounded-lg border bg-[#F9FAFB] px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
