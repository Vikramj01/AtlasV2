// CRM Outcome Integration — /crm (PRD §12).
//
// Sprint 2 scope: connect a HubSpot portal (CrmConnectCard) and run the
// identity readiness check against a config (ReadinessPanel). The client
// picker below is a deliberate stopgap — StageLadderEditor (Sprint 3) is
// the real config-creation surface; this just gives ReadinessPanel a real
// config to check against before that exists.

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PlanGate } from '@/components/common/PlanGate';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { CrmConnectCard } from '@/components/crm/CrmConnectCard';
import { ReadinessPanel } from '@/components/crm/ReadinessPanel';
import { useCrmStore } from '@/store/crmStore';
import { useOrganisationStore } from '@/store/organisationStore';
import { useOrganisations } from '@/hooks/useOrganisations';
import { clientApi } from '@/lib/api/organisationApi';
import type { Client } from '@/types/organisation';
import type { CrmAccountInfo, CrmPipeline } from '@/types/crm';

interface PendingConnection {
  connectionId: string;
  account: CrmAccountInfo;
  pipelines: CrmPipeline[];
}

function CreateConfigStopgap({ pending, onCreated }: { pending: PendingConnection; onCreated: () => void }) {
  const { currentOrg } = useOrganisationStore();
  const { createConfig } = useCrmStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;
    clientApi.list(currentOrg.id).then(setClients).catch(() => setClients([]));
  }, [currentOrg]);

  async function handleCreate() {
    if (!selectedClientId) return;
    setCreating(true);
    setError(null);
    try {
      await createConfig({
        client_id: selectedClientId,
        connection_id: pending.connectionId,
        provider: 'hubspot',
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the sync config.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-console-fg">Assign this connection to a client</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Full stage-ladder mapping comes next — pick a client now so the readiness check has something to run against.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={selectedClientId} onValueChange={setSelectedClientId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-sm text-severity-critical">{error}</p>}
        <Button size="sm" onClick={handleCreate} disabled={!selectedClientId || creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Create sync config
        </Button>
      </CardContent>
    </Card>
  );
}

export function CrmIntegrationPage() {
  const { configs, loadConfigs } = useCrmStore();
  const { loading: orgsLoading } = useOrganisations();
  const [pending, setPending] = useState<PendingConnection | null>(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  return (
    <PlanGate minPlan="pro" featureName="CRM Outcome Integration">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-page-title text-console-fg">CRM Outcome Integration</h1>
          <p className="text-sm text-console-fg-muted mt-1">
            Read HubSpot deal-stage changes into a value-calibrated conversion ladder.
          </p>
        </div>

        <SectionErrorBoundary label="HubSpot connection">
          <CrmConnectCard
            onConnected={(connectionId, account, pipelines) => setPending({ connectionId, account, pipelines })}
          />
        </SectionErrorBoundary>

        {pending && (
          <SectionErrorBoundary label="Assign connection to client">
            <CreateConfigStopgap
              pending={pending}
              onCreated={() => { setPending(null); loadConfigs(); }}
            />
          </SectionErrorBoundary>
        )}

        {!orgsLoading && configs.length > 0 && (
          <SectionErrorBoundary label="Readiness">
            <div className="space-y-4">
              {configs.map((config) => (
                <ReadinessPanel key={config.id} config={config} />
              ))}
            </div>
          </SectionErrorBoundary>
        )}
      </div>
    </PlanGate>
  );
}
