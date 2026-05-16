import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { connectionApi } from '@/lib/api/connectionApi';
import type { PlatformConnectionPublic, ConnectionsResponse, ConnectionGroup } from '@/types/connections';

function flattenConnections(data: { data: ConnectionsResponse }): PlatformConnectionPublic[] {
  const resp = data.data ?? {} as ConnectionsResponse;
  const all: PlatformConnectionPublic[] = [];

  for (const key of ['google_ads', 'meta', 'gtm_destinations'] as const) {
    for (const group of (resp[key] ?? []) as ConnectionGroup[]) {
      all.push(group.manager);
      all.push(...group.children);
    }
  }
  for (const conn of resp.ga4 ?? []) all.push(conn);
  for (const conn of resp.standalone ?? []) all.push(conn);

  return all;
}

export function ReauthBanner() {
  const navigate = useNavigate();
  const [hasExpired, setHasExpired] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    connectionApi.list()
      .then((res) => {
        const all = flattenConnections(res as Parameters<typeof flattenConnections>[0]);
        const expired = all.some((c) => c.status === 'expired' || c.status === 'revoked');
        setHasExpired(expired);
      })
      .catch(() => { /* non-fatal — don't break the dashboard */ });
  }, []);

  if (!hasExpired || dismissed) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-900">
          One or more platform connections have expired. Reconciliation data may be outdated.{' '}
          <button
            type="button"
            onClick={() => navigate('/connections')}
            className="font-medium underline underline-offset-2 hover:text-amber-800"
          >
            Manage connections →
          </button>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-amber-500 hover:text-amber-700"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
