// SourceConnectCard — two-phase OAuth connect flow (HubSpot or Salesforce),
// mirroring GTMContainersSection's connect → discover → finalize pattern
// (ImplementationHealthPage.tsx) for CRM Outcome Integration (PRD §11,
// Sprint 10 generalized this from HubSpot-only to take a `provider` prop).
//
// Both providers land back on their OWN /crm/oauth/{provider}/callback
// route (App.tsx) — currently unreachable pending the Phase 3 outcome
// webhook/rebuild (docs/prd/universal-outcome-ingestion.md), and
// OutcomesPage renders one SourceConnectCard per provider on the same /crm
// page — this card only attempts to resolve
// ?code=&state= when the CURRENT path matches its own provider's callback
// route, so the other provider's card (mounted alongside it) doesn't also
// try to parse a state string shaped for a different provider.

import { useEffect, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { outcomesApi } from '@/lib/api/outcomesApi';
import type { CrmAccountInfo, CrmPipeline, OutcomeSourceType } from '@/types/outcomes';

interface SourceConnectCardProps {
  provider: OutcomeSourceType;
  onConnected?: (connectionId: string, account: CrmAccountInfo, pipelines: CrmPipeline[], provider: OutcomeSourceType) => void;
}

const PROVIDER_LABEL: Record<OutcomeSourceType, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce' };
const PROVIDER_NOUN: Record<OutcomeSourceType, string> = { hubspot: 'portal', salesforce: 'org' };

export function SourceConnectCard({ provider, onConnected }: SourceConnectCardProps) {
  const label = PROVIDER_LABEL[provider];
  const noun = PROVIDER_NOUN[provider];

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Salesforce only — ignored by the HubSpot card.
  const [sandbox, setSandbox] = useState(false);

  // OAuth callback landing state — set once, while /crm/oauth/{provider}/callback
  // is being resolved into a confirmation step (or an error) on this page.
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [discoveredAccount, setDiscoveredAccount] = useState<CrmAccountInfo | null>(null);
  const [discoveredPipelines, setDiscoveredPipelines] = useState<CrmPipeline[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<CrmAccountInfo | null>(null);

  // Land here after the provider redirects back with ?code=&state= — resolve
  // it into a confirmation step exactly once, then strip the one-time code
  // out of the URL so a page refresh doesn't try to reuse it.
  useEffect(() => {
    if (!location.pathname.endsWith(`/oauth/${provider}/callback`)) return;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state) return;

    setDiscovering(true);
    setDiscoverError(null);
    const discover = provider === 'hubspot' ? outcomesApi.discoverHubSpotPortal : outcomesApi.discoverSalesforceOrg;
    discover(code, state)
      .then(({ ref, account, pipelines }) => {
        setPendingRef(ref);
        setDiscoveredAccount(account);
        setDiscoveredPipelines(pipelines);
      })
      .catch((err) => {
        setDiscoverError(err instanceof Error ? err.message : `Failed to complete ${label} connection. Please try again.`);
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
      const { auth_url } = provider === 'hubspot'
        ? await outcomesApi.connectHubSpot()
        : await outcomesApi.connectSalesforce(undefined, sandbox);
      window.location.href = auth_url;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : `Failed to start ${label} connection.`);
      setConnecting(false);
    }
  }

  async function handleFinalize() {
    if (!pendingRef || !discoveredAccount) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const finalize = provider === 'hubspot' ? outcomesApi.finalizeHubSpotConnection : outcomesApi.finalizeSalesforceConnection;
      const { connection_id, account } = await finalize(pendingRef);
      setConnectedAccount(account);
      onConnected?.(connection_id, account, discoveredPipelines, provider);
      setPendingRef(null);
      setDiscoveredAccount(null);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : `Failed to connect this ${noun}. Please try again.`);
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
        <CardTitle className="text-base text-console-fg">{label} Connection</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Connect a {label} {noun} so Atlas can read {provider === 'hubspot' ? 'deal' : 'opportunity'} stage changes and derive conversion outcomes.
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
            <Loader2 className="h-4 w-4 animate-spin" /> Discovering this {noun}…
          </div>
        ) : discoverError ? (
          <p className="text-sm text-severity-critical">{discoverError}</p>
        ) : discoveredAccount ? (
          <div className="space-y-3 rounded-lg border border-console-border bg-console-chip p-3">
            <p className="text-sm text-console-fg">
              Found {noun} <span className="font-medium">{discoveredAccount.account_label}</span> with{' '}
              {discoveredPipelines.length} pipeline{discoveredPipelines.length !== 1 ? 's' : ''}.
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
            <p className="text-sm text-console-fg-muted">No {label} {noun} connected yet.</p>
            {connectError && <p className="mt-1 text-xs text-severity-critical">{connectError}</p>}
            {provider === 'salesforce' && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Checkbox id="sf-sandbox" checked={sandbox} onCheckedChange={(v) => setSandbox(v === true)} />
                <Label htmlFor="sf-sandbox" className="text-xs text-console-fg-muted">This is a sandbox org</Label>
              </div>
            )}
            <Button size="sm" className="mt-3" onClick={handleConnect} disabled={connecting}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Link2 className="h-4 w-4 mr-1" />}
              Connect with {label}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
