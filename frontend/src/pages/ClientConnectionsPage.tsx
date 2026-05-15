import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useConnectionStore } from '@/store/connectionStore';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { PlanGate } from '@/components/common/PlanGate';
import { Button } from '@/components/ui/button';
import { ChevronLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import type { Platform, PlatformConnectionPublic, ConnectionGroup } from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

export function ClientConnectionsPage() {
  return (
    <SectionErrorBoundary label="Client connections">
      <PlanGate minPlan="pro" featureName="Platform Connections">
        <ClientConnectionsPageInner />
      </PlanGate>
    </SectionErrorBoundary>
  );
}

function ClientConnectionsPageInner() {
  const { clientId } = useParams<{ clientId: string }>();

  const {
    connections,
    loading,
    error,
    oauthInProgress,
    actionLoadingId,
    testResults,
    testingId,
    fetchConnections,
    startOAuth,
    connectAccount,
    disconnectAccount,
    testConnection,
    clearError,
  } = useConnectionStore();

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // Collect all connections that belong to this client
  const clientConnections = (() => {
    if (!connections || !clientId) return [];
    const all: PlatformConnectionPublic[] = [
      ...connections.google_ads.flatMap((g: ConnectionGroup) => [g.manager, ...g.children]),
      ...connections.meta.flatMap((g: ConnectionGroup) => [g.manager, ...g.children]),
      ...connections.ga4,
      ...connections.standalone,
    ];
    return all.filter((c) => c.client_id === clientId || c.connection_type === 'manager');
  })();

  const activeForClient: PlatformConnectionPublic[] = clientConnections.filter(
    (c) => c.client_id === clientId && c.status === 'active',
  );

  const availableForClient = (() => {
    if (!connections || !clientId) return [];
    // Available child rows under managers in this org
    return [
      ...connections.google_ads.flatMap((g: ConnectionGroup) => g.children),
      ...connections.meta.flatMap((g: ConnectionGroup) => g.children),
    ].filter((c) => c.status === 'available');
  })();

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Back nav */}
        <Link
          to="/connections"
          className="inline-flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1B2A4A] mb-6"
        >
          <ChevronLeft className="h-4 w-4" />
          All connections
        </Link>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1B2A4A]">Client Connections</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Manage platform connections for this client.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConnections}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={clearError} className="text-red-500 text-xs underline ml-4">Dismiss</button>
          </div>
        )}

        {loading && !connections && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg border border-[#E5E7EB] bg-white animate-pulse" />
            ))}
          </div>
        )}

        {connections && (
          <>
            {/* Active connections for this client */}
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-[#1B2A4A] mb-3">
                Connected ({activeForClient.length})
              </h2>

              {activeForClient.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-8 text-center">
                  <p className="text-sm text-[#9CA3AF]">No platforms connected to this client yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeForClient.map((conn) => (
                    <ConnectionRow
                      key={conn.id}
                      conn={conn}
                      testResult={testResults[conn.id] as TestResult | undefined}
                      isTesting={testingId === conn.id}
                      isActioning={actionLoadingId === conn.id}
                      onDisconnect={() => disconnectAccount(conn.id)}
                      onTest={() => testConnection(conn.id)}
                      onReauth={() => startOAuth(conn.platform, clientId)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Available accounts from existing manager connections */}
            {availableForClient.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold text-[#1B2A4A] mb-1">
                  Available to connect ({availableForClient.length})
                </h2>
                <p className="text-xs text-[#9CA3AF] mb-3">
                  Accounts discovered under your manager connections. Click Connect to add them to this client.
                </p>
                <div className="space-y-2">
                  {availableForClient.map((conn) => (
                    <div key={conn.id} className="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-[#1B2A4A]">
                          {conn.account_label ?? conn.account_id}
                        </p>
                        <p className="text-xs text-[#9CA3AF]">
                          {PLATFORM_LABELS[conn.platform]} · {conn.account_id}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => clientId && connectAccount(conn.id, clientId)}
                        disabled={actionLoadingId === conn.id || !clientId}
                        className="bg-[#1B2A4A] text-white hover:bg-[#243660]"
                      >
                        {actionLoadingId === conn.id ? 'Connecting…' : 'Connect'}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Add new connection */}
            <section>
              <h2 className="text-sm font-semibold text-[#1B2A4A] mb-3">Add new connection</h2>
              <div className="flex flex-wrap gap-2">
                {(['google_ads', 'meta', 'ga4'] as Platform[]).map((p) => (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    onClick={() => startOAuth(p, clientId)}
                    disabled={oauthInProgress !== null}
                  >
                    {oauthInProgress === p ? 'Connecting…' : `Connect ${PLATFORM_LABELS[p]}`}
                  </Button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

interface TestResult {
  ok: boolean;
  latency_ms: number;
  error?: string;
}

interface ConnectionRowProps {
  conn: PlatformConnectionPublic;
  testResult?: TestResult;
  isTesting: boolean;
  isActioning: boolean;
  onDisconnect: () => unknown;
  onTest: () => unknown;
  onReauth: () => unknown;
}

function ConnectionRow({
  conn,
  testResult,
  isTesting,
  isActioning,
  onDisconnect,
  onTest,
  onReauth,
}: ConnectionRowProps) {
  const isExpired = conn.status === 'expired';

  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#1B2A4A] truncate">
              {conn.account_label ?? conn.account_id}
            </p>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusChip(conn.status)}`}>
              {conn.status}
            </span>
          </div>
          <p className="text-xs text-[#9CA3AF]">
            {PLATFORM_LABELS[conn.platform as Platform]} · {conn.account_id}
            {conn.last_synced_at && ` · Last synced ${new Date(conn.last_synced_at).toLocaleDateString()}`}
          </p>
          {conn.last_error && (
            <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {conn.last_error}
            </p>
          )}
          {testResult && (
            <p className={`text-xs mt-0.5 ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testResult.ok
                ? `✓ Connected (${testResult.latency_ms}ms)`
                : `✗ ${testResult.error ?? 'Test failed'}`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isExpired ? (
            <Button size="sm" variant="outline" onClick={onReauth} disabled={isActioning}>
              Re-authorise
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onTest}
                disabled={isTesting || isActioning}
              >
                {isTesting ? 'Testing…' : 'Test'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDisconnect}
                disabled={isActioning}
                className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
              >
                {isActioning ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function statusChip(status: string) {
  switch (status) {
    case 'active':    return 'bg-green-100 text-green-700';
    case 'available': return 'bg-gray-100 text-gray-600';
    case 'expired':   return 'bg-amber-100 text-amber-700';
    case 'revoked':   return 'bg-red-100 text-red-700';
    case 'error':     return 'bg-red-100 text-red-700';
    default:          return 'bg-gray-100 text-gray-600';
  }
}
