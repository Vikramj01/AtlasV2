import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, FileText, ShieldCheck, Upload, ExternalLink } from 'lucide-react';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { ActivityItem } from '@/types/dashboard';

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

const TYPE_ICON: Record<ActivityItem['type'], React.ElementType> = {
  capi_event:       Activity,
  planning_session: FileText,
  consent_config:   ShieldCheck,
  offline_upload:   Upload,
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

  if (items === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-[#F3F4F6]" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-4 text-sm text-[#9CA3AF]">
        Your activity will show up here as you use Atlas.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {items.slice(0, 5).map((item) => {
        const Icon = TYPE_ICON[item.type];
        return (
          <li key={item.id}>
            <Link
              to={item.deep_link}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[#F9FAFB]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] transition-colors group-hover:bg-[#E5E7EB]">
                <Icon className="h-4 w-4 text-[#6B7280]" strokeWidth={1.5} />
              </div>
              <span className="min-w-0 flex-1 text-sm leading-snug text-[#1A1A1A]">
                {item.description}
              </span>
              <span className="shrink-0 text-xs text-[#9CA3AF]">
                {formatRelativeTime(item.created_at)}
              </span>
              <ExternalLink
                className="h-3.5 w-3.5 shrink-0 text-[#D1D5DB] transition-colors group-hover:text-[#9CA3AF]"
                strokeWidth={1.5}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
