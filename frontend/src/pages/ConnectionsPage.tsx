import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConnectionStore } from '@/store/connectionStore';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { PlanGate } from '@/components/common/PlanGate';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { Platform, ConnectionsResponse, ConnectionGroup, PlatformConnectionPublic } from '@/types/connections';

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
    fetchConnections,
    startOAuth,
    handleOAuthReturn,
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

  const hasExpired = (() => {
    if (!connections) return false;
    const all = [
      ...connections.google_ads.flatMap((g) => [g.manager, ...g.children]),
      ...connections.meta.flatMap((g) => [g.manager, ...g.children]),
      ...connections.ga4,
      ...connections.standalone,
    ];
    return all.some((c) => c.status === 'expired');
  })();

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Re-auth banner */}
      {hasExpired && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            One or more connections need re-authorisation. Find expired connections below and click <strong>Re-authorise</strong>.
          </p>
        </div>
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
            onStartOAuth={startOAuth}
            oauthInProgress={oauthInProgress}
          />
        )}
      </div>
    </div>
  );
}

interface ConnectionTabContentProps {
  platform: Platform;
  connections: ConnectionsResponse;
  onStartOAuth: (platform: Platform, clientId?: string) => void;
  oauthInProgress: Platform | null;
}

function ConnectionTabContent({
  platform,
  connections,
  onStartOAuth,
  oauthInProgress,
}: ConnectionTabContentProps) {
  if (!connections) return null;

  const groups: ConnectionGroup[] =
    platform === 'google_ads' ? connections.google_ads
    : platform === 'meta'     ? connections.meta
    : [];

  const standalones: PlatformConnectionPublic[] =
    platform === 'ga4' ? connections.ga4 : connections.standalone.filter((c: PlatformConnectionPublic) => c.platform === platform);

  const isEmpty = groups.length === 0 && standalones.length === 0;

  return (
    <div className="space-y-4">
      {isEmpty && (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-12 text-center">
          <p className="text-sm text-[#6B7280] mb-4">
            No {platform === 'google_ads' ? 'Google Ads' : platform === 'meta' ? 'Meta' : 'GA4'} connections yet.
          </p>
          <Button
            size="sm"
            onClick={() => onStartOAuth(platform)}
            disabled={oauthInProgress !== null}
            className="bg-[#1B2A4A] text-white hover:bg-[#243660]"
          >
            {oauthInProgress === platform ? 'Connecting…' : `Connect ${platform === 'google_ads' ? 'Google Ads' : platform === 'meta' ? 'Meta' : 'GA4'}`}
          </Button>
        </div>
      )}

      {/* Manager groups — components filled in Sprint 1.E */}
      {groups.map((group: ConnectionGroup) => (
        <div key={group.manager.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1B2A4A]">
                {group.manager.account_label ?? group.manager.account_id}
              </p>
              <p className="text-xs text-[#9CA3AF]">Manager Account · {group.children.length} account(s)</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusChip(group.manager.status)}`}>
              {group.manager.status}
            </span>
          </div>
          {/* ManagerConnectionCard replaces this in Sprint 1.E */}
        </div>
      ))}

      {/* Standalone rows */}
      {standalones.map((conn: PlatformConnectionPublic) => (
        <div key={conn.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1B2A4A]">
                {conn.account_label ?? conn.account_id}
              </p>
              <p className="text-xs text-[#9CA3AF]">Standalone · {conn.account_id}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusChip(conn.status)}`}>
              {conn.status}
            </span>
          </div>
        </div>
      ))}

      {/* Add connection CTA when groups exist */}
      {!isEmpty && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onStartOAuth(platform)}
          disabled={oauthInProgress !== null}
        >
          {oauthInProgress === platform ? 'Connecting…' : '+ Add connection'}
        </Button>
      )}
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
