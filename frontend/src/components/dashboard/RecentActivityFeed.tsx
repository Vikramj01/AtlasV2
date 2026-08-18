import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { ActivityItem } from '@/types/dashboard';

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.floor(diffHours / 24)}d`;
}

const TYPE_DOT: Record<ActivityItem['type'], string> = {
  capi_event:       'bg-console-cyan',
  planning_session: 'bg-console-primary',
  consent_config:   'bg-console-fg-subtle',
  offline_upload:   'bg-console-green',
};

export function RecentActivityFeed() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    dashboardApi
      .getActivity()
      .then((r) => setItems(r.data))
      .catch(() => setError(true));
  }, []);

  if (error) return null;

  return (
    <div className="rounded-[10px] border border-console-border bg-console-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-console-border px-[22px] py-[18px]">
        <h4 className="font-heading text-base font-bold text-console-fg">Recent activity</h4>
        <Link to="/dashboard" className="font-heading text-[13px] font-semibold text-console-primary hover:underline">
          View all
        </Link>
      </div>

      {items === null ? (
        <div className="space-y-2 p-[22px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-console-chip" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-[22px] py-6 text-sm text-console-fg-subtle">
          Your activity will show up here as you use Atlas.
        </p>
      ) : (
        <ul>
          {items.slice(0, 5).map((item) => (
            <li key={item.id} className="border-b border-console-border last:border-0">
              <Link
                to={item.deep_link}
                className="flex items-center gap-4 px-[22px] py-[14px] transition-colors hover:bg-console-chip"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[item.type]}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-console-fg">{item.description}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-console-fg-subtle">{item.type}</div>
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-xs text-console-fg-subtle">
                  {formatRelativeTime(item.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
