import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
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

interface ChildAccountRowProps {
  conn: PlatformConnectionPublic;
  clientId?: string;
  testResult?: TestResult;
  isTesting: boolean;
  isActioning: boolean;
  onConnect: (connectionId: string, clientId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onTest: (connectionId: string) => void;
  onReauth: (platform: Platform, clientId?: string) => void;
}

export function ChildAccountRow({
  conn,
  clientId,
  testResult,
  isTesting,
  isActioning,
  onConnect,
  onDisconnect,
  onTest,
  onReauth,
}: ChildAccountRowProps) {
  const isAvailable = conn.status === 'available';
  const isActive    = conn.status === 'active';
  const isExpired   = conn.status === 'expired';

  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5 rounded-md hover:bg-[#F9FAFB] transition-colors">
      <div className="flex items-start gap-2 min-w-0">
        {/* Indent indicator */}
        <div className="mt-1.5 shrink-0 h-3 w-3 rounded-full border-2 border-[#D1D5DB]" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[#1B2A4A] truncate">
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
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
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
        {isAvailable && clientId && (
          <Button
            size="sm"
            onClick={() => onConnect(conn.id, clientId)}
            disabled={isActioning}
            className="bg-[#1B2A4A] text-white hover:bg-[#243660]"
          >
            {isActioning ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>
    </div>
  );
}
