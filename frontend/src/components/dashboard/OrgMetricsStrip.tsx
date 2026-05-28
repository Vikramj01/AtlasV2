import type { OrgMetrics } from '@/types/dashboard';

interface MetricTileProps {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}

function MetricTile({ label, value, sub, highlight }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-white px-4 py-3 flex-1 min-w-0">
      <span className="text-xs text-muted-foreground font-medium truncate">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${highlight ? 'text-red-600' : 'text-foreground'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
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
      />
      <MetricTile
        label="Signals monitored"
        value={metrics.total_signals_monitored}
      />
      <MetricTile
        label="CAPI events (24h)"
        value={metrics.capi_events_24h.toLocaleString()}
      />
      <MetricTile
        label="Avg match quality (7d)"
        value={matchQuality}
      />
      <MetricTile
        label="Clients with issues"
        value={metrics.clients_with_issues}
        highlight={metrics.clients_with_issues > 0}
      />
    </div>
  );
}
