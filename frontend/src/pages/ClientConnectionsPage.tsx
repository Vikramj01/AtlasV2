import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useConnectionStore } from '@/store/connectionStore';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { PlanGate } from '@/components/common/PlanGate';
import { Button } from '@/components/ui/button';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { ReauthBanner } from '@/components/connections/ReauthBanner';
import { ConnectionCard } from '@/components/connections/ConnectionCard';
import { OAuthInitiateButton } from '@/components/connections/OAuthInitiateButton';
import { AccountPickerModal } from '@/components/connections/AccountPickerModal';
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
    discoveredAccounts,
    standaloneDiscovered,
    showPickerForManager,
    testResults,
    testingId,
    actionLoadingId,
    fetchConnections,
    startOAuth,
    connectAccount,
    disconnectAccount,
    testConnection,
    clearPicker,
    clearError,
  } = useConnectionStore();

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

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
    return [
      ...connections.google_ads.flatMap((g: ConnectionGroup) => g.children),
      ...connections.meta.flatMap((g: ConnectionGroup) => g.children),
    ].filter((c) => c.status === 'available');
  })();

  const expiredCount = activeForClient.filter((c) => c.status === 'expired').length;

  const allDiscovered = [...discoveredAccounts, ...standaloneDiscovered];

  const testResultsTyped = testResults as Record<string, { ok: boolean; latency_ms: number; error?: string }>;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <ReauthBanner expiredCount={expiredCount} />

      {showPickerForManager && (
        <AccountPickerModal
          managerId={showPickerForManager}
          accounts={allDiscovered}
          clientId={clientId}
          onConnect={connectAccount}
          onClose={clearPicker}
          actionLoadingId={actionLoadingId}
        />
      )}

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
                    <ConnectionCard
                      key={conn.id}
                      conn={conn}
                      actions={
                        <ActiveConnectionActions
                          conn={conn}
                          testResult={testResultsTyped[conn.id]}
                          isTesting={testingId === conn.id}
                          isActioning={actionLoadingId === conn.id}
                          onDisconnect={disconnectAccount}
                          onTest={testConnection}
                          onReauth={(p) => startOAuth(p, clientId)}
                        />
                      }
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
                  <OAuthInitiateButton
                    key={p}
                    platform={p}
                    clientId={clientId}
                    inProgress={oauthInProgress === p}
                    onStart={startOAuth}
                    variant="outline"
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

interface ActiveConnectionActionsProps {
  conn: PlatformConnectionPublic;
  testResult?: { ok: boolean; latency_ms: number; error?: string };
  isTesting: boolean;
  isActioning: boolean;
  onDisconnect: (id: string) => void;
  onTest: (id: string) => void;
  onReauth: (platform: Platform) => void;
}

function ActiveConnectionActions({
  conn,
  isTesting,
  isActioning,
  onDisconnect,
  onTest,
  onReauth,
}: ActiveConnectionActionsProps) {
  const isExpired = conn.status === 'expired';

  if (isExpired) {
    return (
      <Button size="sm" variant="outline" onClick={() => onReauth(conn.platform)} disabled={isActioning}>
        Re-authorise
      </Button>
    );
  }

  return (
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
        {isActioning ? 'Disconnecting…' : 'Disconnect'}
      </Button>
    </>
  );
}
