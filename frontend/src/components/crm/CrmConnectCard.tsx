// CrmConnectCard — HubSpot two-phase OAuth connect flow, mirroring
// GTMContainersSection's connect → discover → finalize pattern
// (ImplementationHealthPage.tsx) for CRM Outcome Integration (PRD §11).

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle2, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { crmApi } from '@/lib/api/crmApi';
import type { CrmAccountInfo, CrmPipeline } from '@/types/crm';

interface CrmConnectCardProps {
  onConnected?: (connectionId: string, account: CrmAccountInfo, pipelines: CrmPipeline[]) => void;
}

export function CrmConnectCard({ onConnected }: CrmConnectCardProps) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // OAuth callback landing state — set once, while /crm/oauth/hubspot/callback
  // is being resolved into a confirmation step (or an error) on this page.
  const [searchParams, setSearchParams] = useSearchParams();
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [discoveredAccount, setDiscoveredAccount] = useState<CrmAccountInfo | null>(null);
  const [discoveredPipelines, setDiscoveredPipelines] = useState<CrmPipeline[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<CrmAccountInfo | null>(null);

  // Land here after HubSpot redirects back with ?code=&state= — resolve it
  // into a confirmation step exactly once, then strip the one-time code out
  // of the URL so a page refresh doesn't try to reuse it.
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) return;

    setDiscovering(true);
    setDiscoverError(null);
    crmApi.discoverHubSpotPortal(code, state)
      .then(({ ref, account, pipelines }) => {
        setPendingRef(ref);
        setDiscoveredAccount(account);
        setDiscoveredPipelines(pipelines);
      })
      .catch((err) => {
        setDiscoverError(err instanceof Error ? err.message : 'Failed to complete HubSpot connection. Please try again.');
      })
      .finally(() => {
        setDiscovering(false);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('code');
          next.delete('state');
          return next;
        }, { replace: true });
      });
    // Only ever run once per landing on this route with real code/state params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { auth_url } = await crmApi.connectHubSpot();
      window.location.href = auth_url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to start HubSpot connection.');
      setConnecting(false);
    }
  }

  async function handleFinalize() {
    if (!pendingRef || !discoveredAccount) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const { connection_id, account } = await crmApi.finalizeHubSpotConnection(pendingRef);
      setConnectedAccount(account);
      onConnected?.(connection_id, account, discoveredPipelines);
      setPendingRef(null);
      setDiscoveredAccount(null);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Failed to connect this portal. Please try again.');
    } finally {
      setFinalizing(false);
    }
  }

  function handleCancel() {
    setPendingRef(null);
    setDiscoveredAccount(null);
    setDiscoveredPipelines([]);
    setFinalizeError(null);
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-console-fg">HubSpot Connection</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Connect a HubSpot portal so Atlas can read deal stage changes and derive conversion outcomes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {connectedAccount ? (
          <div className="flex items-center gap-2 rounded-lg border border-console-border bg-console-chip p-3">
            <CheckCircle2 className="h-4 w-4 text-console-green flex-shrink-0" />
            <p className="text-sm text-console-fg">
              Connected to <span className="font-medium">{connectedAccount.account_label}</span>
            </p>
          </div>
        ) : discovering ? (
          <div className="flex items-center gap-2 text-sm text-console-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Discovering this portal…
          </div>
        ) : discoverError ? (
          <p className="text-sm text-severity-critical">{discoverError}</p>
        ) : discoveredAccount ? (
          <div className="space-y-3 rounded-lg border border-console-border bg-console-chip p-3">
            <p className="text-sm text-console-fg">
              Found portal <span className="font-medium">{discoveredAccount.account_label}</span> with{' '}
              {discoveredPipelines.length} deal pipeline{discoveredPipelines.length !== 1 ? 's' : ''}.
            </p>
            {finalizeError && <p className="text-sm text-severity-critical">{finalizeError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleFinalize} disabled={finalizing}>
                {finalizing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Confirm connection
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={finalizing}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-console-border p-6 text-center">
            <p className="text-sm text-console-fg-muted">No HubSpot portal connected yet.</p>
            {connectError && <p className="mt-1 text-xs text-severity-critical">{connectError}</p>}
            <Button size="sm" className="mt-3" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
              Connect with HubSpot
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
