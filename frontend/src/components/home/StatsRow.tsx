import { useEffect } from 'react';
import { useDashboardStore } from '@/store/dashboardStore';

interface StatDef {
  label: string;
  value: string;
  colorClass: string;
}

function StatCard({ label, value, colorClass }: StatDef) {
  return (
    <div className={`rounded-lg border border-console-border border-l-2 bg-console-surface px-5 py-[18px] ${colorClass}`}>
      <div className="font-heading text-xs font-semibold uppercase tracking-[0.1em] text-console-fg-subtle">
        {label}
      </div>
      <div className="mt-2 font-mono text-[26px] font-semibold text-console-fg">{value}</div>
    </div>
  );
}

/**
 * KPI stats row on Home — reuses the same org_metrics data that powers
 * ReturningUserDashboard's OrgMetricsStrip (fetched independently here,
 * since Home and /dashboard are different routes).
 */
export function StatsRow() {
  const { summary, summaryLoadState, fetchSummary } = useDashboardStore();

  useEffect(() => {
    if (summaryLoadState === 'idle') fetchSummary();
  }, [summaryLoadState, fetchSummary]);

  if (summaryLoadState === 'loading' || summaryLoadState === 'idle') {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-lg bg-console-chip" />
        ))}
      </div>
    );
  }

  if (summaryLoadState === 'error' || !summary) return null;

  const metrics = summary.org_metrics;
  const matchQuality = metrics.avg_match_quality_7d !== null
    ? `${metrics.avg_match_quality_7d.toFixed(0)}%`
    : '—';

  const stats: StatDef[] = [
    { label: 'Active clients', value: String(metrics.total_clients), colorClass: 'border-l-console-primary' },
    { label: 'Signals monitored', value: String(metrics.total_signals_monitored), colorClass: 'border-l-console-cyan' },
    { label: 'Clients with issues', value: String(metrics.clients_with_issues), colorClass: metrics.clients_with_issues > 0 ? 'border-l-console-amber' : 'border-l-console-green' },
    { label: 'Avg match quality (7d)', value: matchQuality, colorClass: 'border-l-console-green' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => <StatCard key={s.label} {...s} />)}
    </div>
  );
}
