import { cn } from '@/lib/utils';
import type { OrgMetrics } from '@/types/dashboard';

interface MetricTileProps {
  label: string;
  value: string | number;
  colorClass: string;
}

// Mirrors Home's StatsRow StatCard styling — same underlying org_metrics,
// same "operator console" stat-tile treatment (left accent bar, mono value).
function MetricTile({ label, value, colorClass }: MetricTileProps) {
  return (
    <div className={cn('rounded-lg border border-console-border border-l-2 bg-console-surface px-5 py-[18px] flex-1 min-w-0', colorClass)}>
      <div className="font-heading text-xs font-semibold uppercase tracking-[0.1em] text-console-fg-subtle truncate">
        {label}
      </div>
      <div className="mt-2 font-mono text-[26px] font-semibold text-console-fg">{value}</div>
    </div>
  );
}

interface OrgMetricsStripProps {
  metrics: OrgMetrics;
}

export function OrgMetricsStrip({ metrics }: OrgMetricsStripProps) {
  const matchQuality =
    metrics.avg_match_quality_7d !== null
      ? `${metrics.avg_match_quality_7d.toFixed(1)}%`
      : '—';

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      <MetricTile
        label="Active clients"
        value={metrics.total_clients}
        colorClass="border-l-console-primary"
      />
      <MetricTile
        label="Signals monitored"
        value={metrics.total_signals_monitored}
        colorClass="border-l-console-cyan"
      />
      <MetricTile
        label="CAPI events (24h)"
        value={metrics.capi_events_24h.toLocaleString()}
        colorClass="border-l-console-violet"
      />
      <MetricTile
        label="Avg match quality (7d)"
        value={matchQuality}
        colorClass="border-l-console-green"
      />
      <MetricTile
        label="Clients with issues"
        value={metrics.clients_with_issues}
        colorClass={metrics.clients_with_issues > 0 ? 'border-l-console-red' : 'border-l-console-green'}
      />
    </div>
  );
}
