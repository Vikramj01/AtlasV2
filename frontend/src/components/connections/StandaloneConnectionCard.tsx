import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';
import type { PlatformConnectionPublic, Platform } from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

interface TestResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

interface StandaloneConnectionCardProps {
  conn: PlatformConnectionPublic;
  testResult?: TestResult;
  isTesting: boolean;
  isActioning: boolean;
  onTest: (connectionId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onRemove: (connectionId: string) => void;
  onReauth: (platform: Platform, clientId?: string) => void;
}

export function StandaloneConnectionCard({
  conn,
  testResult,
  isTesting,
  isActioning,
  onTest,
  onDisconnect,
  onRemove,
  onReauth,
}: StandaloneConnectionCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isExpired = conn.status === 'expired';
  const isActive  = conn.status === 'active';

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
            {PLATFORM_LABELS[conn.platform]} · {conn.account_id}
            {conn.last_synced_at && ` · Synced ${new Date(conn.last_synced_at).toLocaleDateString()}`}
          </p>
          {conn.last_error && (
            <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {conn.last_error}
            </p>
          )}
          {testResult && (
            <p className={`text-xs mt-0.5 ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.ok
                ? `Connected (${testResult.latency_ms}ms)`
                : `${testResult.error ?? 'Test failed'}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isExpired && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReauth(conn.platform, conn.client_id ?? undefined)}
              disabled={isActioning}
            >
              Re-authorise
            </Button>
          )}
          {isActive && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onTest(conn.id)}
                disabled={isTesting || isActioning}
              >
                {isTesting ? 'Testing…' : 'Test'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onDisconnect(conn.id)}
                disabled={isActioning}
                className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              >
                {isActioning ? 'Working…' : 'Disconnect'}
              </Button>
            </>
          )}
          {confirmRemove ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600">Remove?</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRemove(false)}
                className="h-7 px-2 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => onRemove(conn.id)}
                disabled={isActioning}
                className="h-7 px-2 text-xs bg-red-600 text-white hover:bg-red-700 border-red-600"
              >
                Confirm
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              className="text-[#9CA3AF] hover:text-red-600 transition-colors"
              aria-label="Remove connection"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
