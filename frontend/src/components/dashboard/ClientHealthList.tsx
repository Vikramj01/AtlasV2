import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle, ChevronRight, Plug } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DashboardClientSummaryItem } from '@/types/dashboard';

const HEALTH_CONFIG: Record<
  DashboardClientSummaryItem['health_level'],
  { Icon: typeof CheckCircle2; color: string; label: string }
> = {
  healthy:  { Icon: CheckCircle2,  color: 'text-green-500',          label: 'Healthy' },
  warning:  { Icon: AlertTriangle, color: 'text-amber-500',          label: 'Warning' },
  critical: { Icon: AlertCircle,   color: 'text-red-500',            label: 'Critical' },
  unknown:  { Icon: HelpCircle,    color: 'text-muted-foreground/50', label: 'Not set up' },
};

interface ClientHealthListProps {
  clients: DashboardClientSummaryItem[];
  orgId: string;
}

export function ClientHealthList({ clients, orgId }: ClientHealthListProps) {
  if (clients.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">No active clients yet.</p>
        <Link
          to={`/org/${orgId}/clients`}
          className="mt-1 text-xs text-primary hover:underline"
        >
          Add your first client →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {clients.map((client) => {
        const { Icon, color, label } = HEALTH_CONFIG[client.health_level];

        return (
          <Link
            key={client.id}
            to={`/org/${orgId}/clients/${client.id}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-white px-4 py-3 hover:border-primary/30 hover:bg-primary/5 transition-colors"
          >
            <Icon className={cn('h-4 w-4 shrink-0', color)} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground truncate">{client.name}</span>
                {client.open_findings_count > 0 && (
                  <span className="shrink-0 text-[10px] font-semibold rounded-full bg-red-100 text-red-700 px-1.5 py-0.5">
                    {client.open_findings_count} issue{client.open_findings_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                {client.platforms_connected.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Plug className="h-3 w-3" />
                    {client.platforms_connected.join(', ')}
                  </span>
                )}
                {client.signals_count > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {client.signals_count} signal pack{client.signals_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
