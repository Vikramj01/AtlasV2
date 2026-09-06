import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle, ChevronRight, Plug, Radio, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DashboardClientSummaryItem } from '@/types/dashboard';

const HEALTH_CONFIG: Record<
  DashboardClientSummaryItem['health_level'],
  { Icon: typeof CheckCircle2; color: string; label: string }
> = {
  healthy:  { Icon: CheckCircle2,  color: 'text-console-green',        label: 'Healthy' },
  warning:  { Icon: AlertTriangle, color: 'text-console-amber',        label: 'Warning' },
  critical: { Icon: AlertCircle,   color: 'text-console-red',          label: 'Critical' },
  unknown:  { Icon: HelpCircle,    color: 'text-console-fg-disabled',  label: 'Not set up' },
};

const HEALTH_SORT_RANK: Record<DashboardClientSummaryItem['health_level'], number> = {
  critical: 3, warning: 2, unknown: 1, healthy: 0,
};

type SortBy = 'severity' | 'name';

function sortClients(clients: DashboardClientSummaryItem[], sortBy: SortBy): DashboardClientSummaryItem[] {
  return [...clients].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    // health_level already folds in DQM/CAPI signals (not just findings) —
    // it's the single source of truth for "which client needs attention".
    return HEALTH_SORT_RANK[b.health_level] - HEALTH_SORT_RANK[a.health_level]
      || b.open_findings_count - a.open_findings_count
      || a.name.localeCompare(b.name);
  });
}

interface ClientHealthListProps {
  clients: DashboardClientSummaryItem[];
  orgId: string;
}

export function ClientHealthList({ clients, orgId }: ClientHealthListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('severity');

  if (clients.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-console-border px-4 py-6 text-center">
        <p className="text-sm text-console-fg-subtle">No active clients yet.</p>
        <Link
          to={`/org/${orgId}/clients`}
          className="mt-1 text-xs text-console-primary hover:underline"
        >
          Add your first client →
        </Link>
      </div>
    );
  }

  const sortedClients = sortClients(clients, sortBy);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <label htmlFor="client-health-sort" className="text-xs text-console-fg-subtle">
          Sort by
        </label>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger id="client-health-sort" className="h-7 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="severity">Most severe first</SelectItem>
            <SelectItem value="name">A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {sortedClients.map((client) => {
        const { Icon, color, label } = HEALTH_CONFIG[client.health_level];

        return (
          <Link
            key={client.id}
            to={`/org/${orgId}/clients/${client.id}`}
            className="flex items-center gap-3 rounded-lg border border-console-border bg-console-surface px-4 py-3 hover:border-console-primary/30 hover:bg-console-primary/[0.04] transition-colors"
          >
            <Icon className={cn('h-4 w-4 shrink-0', color)} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-console-fg truncate">{client.name}</span>
                {client.open_findings_count > 0 && (
                  <span className="shrink-0 text-[10px] font-semibold rounded-full bg-console-red/10 text-console-red px-1.5 py-0.5">
                    {client.open_findings_count} issue{client.open_findings_count !== 1 ? 's' : ''}
                  </span>
                )}
                {client.dqm_alert_count > 0 && (
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-semibold rounded-full px-1.5 py-0.5',
                      client.dqm_worst_severity === 'critical' ? 'bg-console-red/10 text-console-red' : 'bg-console-amber/10 text-console-amber',
                    )}
                  >
                    {client.dqm_alert_count} DQM alert{client.dqm_alert_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-console-fg-subtle">{label}</span>
                {client.platforms_connected.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-console-fg-subtle">
                    <Plug className="h-3 w-3" />
                    {client.platforms_connected.join(', ')}
                  </span>
                )}
                {client.signals_count > 0 && (
                  <span className="text-xs text-console-fg-subtle">
                    {client.signals_count} signal pack{client.signals_count !== 1 ? 's' : ''}
                  </span>
                )}
                {client.capi_match_quality_7d !== null && (
                  <span className="flex items-center gap-1 text-xs text-console-fg-subtle">
                    <Radio className="h-3 w-3" />
                    EMQ {client.capi_match_quality_7d.toFixed(1)}
                  </span>
                )}
                {client.capi_dedup_rate_7d !== null && (
                  <span className="flex items-center gap-1 text-xs text-console-fg-subtle">
                    <Percent className="h-3 w-3" />
                    {client.capi_dedup_rate_7d.toFixed(0)}% dedup
                  </span>
                )}
              </div>
            </div>

            <ChevronRight className="h-4 w-4 text-console-fg-subtle shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
