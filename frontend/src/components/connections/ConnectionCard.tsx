import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import type { PlatformConnectionPublic, Platform } from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

interface ConnectionCardProps {
  conn: PlatformConnectionPublic;
  actions?: ReactNode;
}

export function ConnectionCard({ conn, actions }: ConnectionCardProps) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#1B2A4A] truncate">
              {conn.account_label ?? conn.account_id}
            </p>
            <ConnectionStatusBadge status={conn.status} />
          </div>
          <p className="text-xs text-[#9CA3AF]">
            {PLATFORM_LABELS[conn.platform as Platform]} · {conn.account_id}
            {conn.connection_type !== 'standalone' && ` · ${conn.connection_type}`}
            {conn.last_synced_at && ` · Synced ${new Date(conn.last_synced_at).toLocaleDateString()}`}
          </p>
          {conn.last_error && (
            <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {conn.last_error}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
