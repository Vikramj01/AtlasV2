import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConnectionStore } from '@/store/connectionStore';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { PlanGate } from '@/components/common/PlanGate';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { ReauthBanner } from '@/components/connections/ReauthBanner';
import { ManagerConnectionCard } from '@/components/connections/ManagerConnectionCard';
import { StandaloneConnectionCard } from '@/components/connections/StandaloneConnectionCard';
import { OAuthInitiateButton } from '@/components/connections/OAuthInitiateButton';
import { AccountPickerModal } from '@/components/connections/AccountPickerModal';
import type {
  Platform,
  ConnectionsResponse,
  ConnectionGroup,
  PlatformConnectionPublic,
  DiscoveredAccount,
} from '@/types/connections';

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads:       'Google Ads',
  meta:             'Meta',
  ga4:              'GA4',
  gtm_destinations: 'GTM Destinations',
};

const TABS: Platform[] = ['google_ads', 'meta', 'ga4'];

export function ConnectionsPage() {
  return (
    <SectionErrorBoundary label="Connections">
      <PlanGate minPlan="pro" featureName="Platform Connections">
        <ConnectionsPageInner />
      </PlanGate>
    </SectionErrorBoundary>
  );
}

function ConnectionsPageInner() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Platform>('google_ads');

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
    handleOAuthReturn,
    connectAccount,
    disconnectAccount,
    rediscover,
    removeConnection,
    testConnection,
    clearPicker,
    clearError,
  } = useConnectionStore();

  // Handle OAuth return: /connections?platform=google_ads&code=...&state=...
  useEffect(() => {
    const platform = searchParams.get('platform') as Platform | null;
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (platform && code && state) {
      handleOAuthReturn(platform, code, state);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const expiredCount = (() => {
    if (!connections) return 0;
    const all: PlatformConnectionPublic[] = [
      ...connections.google_ads.flatMap((g: ConnectionGroup) => [g.manager, ...g.children]),
      ...connections.meta.flatMap((g: ConnectionGroup) => [g.manager, ...g.children]),
      ...connections.ga4,
      ...connections.standalone,
    ];
    return all.filter((c) => c.status === 'expired').length;
  })();

  // Combine discovered accounts for the picker modal
  const allDiscovered = [...discoveredAccounts, ...standaloneDiscovered];

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <ReauthBanner expiredCount={expiredCount} />

      {/* Account picker after OAuth */}
      {showPickerForManager && (
        <AccountPickerModal
          managerId={showPickerForManager}
          accounts={allDiscovered}
          onConnect={connectAccount}
          onClose={clearPicker}
          actionLoadingId={actionLoadingId}
        />
      )}

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#1B2A4A]">Platform Connections</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Connect your ad platforms to enable signal reconciliation.
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

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={clearError} className="text-red-500 text-xs underline ml-4">Dismiss</button>
          </div>
        )}

        {/* Platform tabs */}
        <div className="flex gap-1 border-b border-[#E5E7EB] mb-6">
          {TABS.map((p) => (
            <button
              key={p}
              onClick={() => setActiveTab(p)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === p
                  ? 'border-[#1B2A4A] text-[#1B2A4A]'
                  : 'border-transparent text-[#6B7280] hover:text-[#1B2A4A]'
              }`}
            >
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && !connections && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-24 rounded-lg border border-[#E5E7EB] bg-white animate-pulse" />
            ))}
          </div>
        )}

        {/* Connection list for active tab */}
        {connections && (
          <ConnectionTabContent
            platform={activeTab}
            connections={connections}
            testResults={testResults as Record<string, { ok: boolean; latency_ms: number; error?: string }>}
            testingId={testingId}
            actionLoadingId={actionLoadingId}
            oauthInProgress={oauthInProgress}
            onStartOAuth={startOAuth}
            onConnect={connectAccount}
            onDisconnect={disconnectAccount}
            onTest={testConnection}
            onRediscover={rediscover}
            onRemove={removeConnection}
          />
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

interface ConnectionTabContentProps {
  platform: Platform;
  connections: ConnectionsResponse;
  testResults: Record<string, TestResult>;
  testingId: string | null;
  actionLoadingId: string | null;
  oauthInProgress: Platform | null;
  onStartOAuth: (platform: Platform, clientId?: string) => void;
  onConnect: (connectionId: string, clientId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onTest: (connectionId: string) => void;
  onRediscover: (connectionId: string) => Promise<DiscoveredAccount[]>;
  onRemove: (connectionId: string) => void;
}

function ConnectionTabContent({
  platform,
  connections,
  testResults,
  testingId,
  actionLoadingId,
  oauthInProgress,
  onStartOAuth,
  onConnect,
  onDisconnect,
  onTest,
  onRediscover,
  onRemove,
}: ConnectionTabContentProps) {
  const groups: ConnectionGroup[] =
    platform === 'google_ads' ? connections.google_ads
    : platform === 'meta'     ? connections.meta
    : [];

  const standalones: PlatformConnectionPublic[] =
    platform === 'ga4'
      ? connections.ga4
      : connections.standalone.filter((c: PlatformConnectionPublic) => c.platform === platform);

  const isEmpty = groups.length === 0 && standalones.length === 0;

  return (
    <div className="space-y-4">
      {isEmpty && (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-12 text-center">
          <p className="text-sm text-[#6B7280] mb-4">
            No {platform === 'google_ads' ? 'Google Ads' : platform === 'meta' ? 'Meta' : 'GA4'} connections yet.
          </p>
          <OAuthInitiateButton
            platform={platform}
            inProgress={oauthInProgress === platform}
            onStart={onStartOAuth}
          />
        </div>
      )}

      {groups.map((group: ConnectionGroup) => (
        <ManagerConnectionCard
          key={group.manager.id}
          group={group}
          testResults={testResults}
          testingId={testingId}
          actionLoadingId={actionLoadingId}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onTest={onTest}
          onRediscover={onRediscover}
          onRemove={onRemove}
          onReauth={onStartOAuth}
        />
      ))}

      {standalones.map((conn: PlatformConnectionPublic) => (
        <StandaloneConnectionCard
          key={conn.id}
          conn={conn}
          testResult={testResults[conn.id]}
          isTesting={testingId === conn.id}
          isActioning={actionLoadingId === conn.id}
          onTest={onTest}
          onDisconnect={onDisconnect}
          onRemove={onRemove}
          onReauth={onStartOAuth}
        />
      ))}

      {!isEmpty && (
        <OAuthInitiateButton
          platform={platform}
          inProgress={oauthInProgress === platform}
          onStart={onStartOAuth}
          variant="outline"
          label="+ Add connection"
        />
      )}
    </div>
  );
}
