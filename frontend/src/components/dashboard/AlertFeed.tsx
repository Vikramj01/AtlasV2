import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, CheckCircle2, ChevronRight, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DashboardAlertItem } from '@/types/dashboard';

const SEVERITY_CONFIG: Record<
  DashboardAlertItem['severity'],
  { Icon: typeof AlertTriangle; color: string; badge: string }
> = {
  critical: { Icon: AlertCircle,   color: 'text-red-600',    badge: 'bg-red-100 text-red-700 border-red-200' },
  high:     { Icon: AlertTriangle, color: 'text-amber-600',  badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  medium:   { Icon: AlertTriangle, color: 'text-yellow-600', badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  low:      { Icon: Info,          color: 'text-blue-500',   badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  info:     { Icon: Info,          color: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground border-border' },
};

interface AlertRowProps {
  alert: DashboardAlertItem;
  onReview: () => void;
}

function AlertRow({ alert, onReview }: AlertRowProps) {
  const cfg = SEVERITY_CONFIG[alert.severity];
  const { Icon } = cfg;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 transition-opacity',
        alert.is_reviewed ? 'opacity-50' : '',
        alert.is_new && !alert.is_reviewed ? 'border-amber-200 bg-amber-50/40' : 'border-border bg-white',
      )}
    >
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cfg.color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{alert.title}</span>
          {alert.is_new && !alert.is_reviewed && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
              New
            </span>
          )}
          <Badge variant="outline" className={cn('text-[10px] py-0 h-4', cfg.badge)}>
            {alert.severity}
          </Badge>
          {alert.client_name && (
            <span className="text-xs text-muted-foreground">{alert.client_name}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!alert.is_reviewed && (
          <button
            type="button"
            onClick={onReview}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Mark as reviewed"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        )}
        {alert.is_reviewed && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
        <Link
          to={alert.action_url}
          className="flex items-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

interface AlertFeedProps {
  alerts: DashboardAlertItem[];
  onReview: (sourceTable: string, sourceId: string) => void;
}

const PAGE_SIZE = 10;

export function AlertFeed({ alerts, onReview }: AlertFeedProps) {
  const [showAll, setShowAll] = useState(false);

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-green-100 bg-green-50/50 px-4 py-6 text-center">
        <CheckCircle2 className="mx-auto h-6 w-6 text-green-500 mb-2" />
        <p className="text-sm font-medium text-green-800">No open alerts</p>
        <p className="text-xs text-green-700 mt-0.5">Everything looks healthy since your last visit.</p>
      </div>
    );
  }

  const visible = showAll ? alerts : alerts.slice(0, PAGE_SIZE);
  const hidden = alerts.length - PAGE_SIZE;

  return (
    <div className="space-y-2">
      {visible.map((alert) => (
        <AlertRow
          key={`${alert.source_table}-${alert.id}`}
          alert={alert}
          onReview={() => onReview(alert.source_table, alert.id)}
        />
      ))}
      {!showAll && hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => setShowAll(true)}
        >
          Show {hidden} more alert{hidden !== 1 ? 's' : ''}
        </Button>
      )}
    </div>
  );
}
