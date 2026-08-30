import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle, ChevronRight, Plug } from 'lucide-react';
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

type SortBy = 'issues' | 'name';

function sortClients(clients: DashboardClientSummaryItem[], sortBy: SortBy): DashboardClientSummaryItem[] {
  return [...clients].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return b.open_findings_count - a.open_findings_count || a.name.localeCompare(b.name);
  });
}

interface ClientHealthListProps {
  clients: DashboardClientSummaryItem[];
  orgId: string;
}

export function ClientHealthList({ clients, orgId }: ClientHealthListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('issues');

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
            <SelectItem value="issues">Most issues first</SelectItem>
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
              </div>
            </div>

            <ChevronRight className="h-4 w-4 text-console-fg-subtle shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
