// WebhookSourceCard — Universal Outcome Ingestion Phase 3 (§6).
//
// Creates a webhook-type outcome source (no OAuth — Atlas receives calls
// rather than authenticating outward, mirroring SourceConnectCard's
// connect/discover/finalize shape for the pull sources but with a single
// creation step) and, for every already-created webhook config, shows the
// one thing an operator actually needs afterward: the tier-1/2/3 breakdown
// of what's landing on it, and the delivery-enabled toggle with whatever
// reason deliveryGate.ts's auto-disable last set.
//
// The plaintext secret is shown exactly once, immediately after creation —
// every other read of this config returns only webhook_secret_encrypted
// (backend/src/api/routes/outcomes.ts's own documented contract), so this
// component never attempts to display or refetch it again.

import { useEffect, useState } from 'react';
import { Loader2, Copy, Check, AlertTriangle, Webhook } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { outcomesApi } from '@/lib/api/outcomesApi';
import { useOutcomesStore } from '@/store/outcomesStore';
import { useOrganisationStore } from '@/store/organisationStore';
import { clientApi } from '@/lib/api/organisationApi';
import type { Client } from '@/types/organisation';
import type { CreatedWebhookOutcomeSourceConfig, OutcomeSourceConfig } from '@/types/outcomes';

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, non-secure context) —
      // the value is still selectable/visible in the input, so this is a
      // convenience failure, not a blocker.
    }
  }

  return (
    <div>
      <p className="text-xs text-console-fg-muted mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded border border-console-border bg-console-chip px-2 py-1.5 text-xs text-console-fg">
          {value}
        </code>
        <Button size="sm" variant="outline" onClick={handleCopy} className="flex-shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function CreatedSecretPanel({ created }: { created: CreatedWebhookOutcomeSourceConfig }) {
  return (
    <div className="space-y-3 rounded-lg border border-severity-warning bg-severity-warning-bg p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-severity-warning flex-shrink-0 mt-0.5" />
        <p className="text-sm text-console-fg">
          Save this secret now — it will not be shown again. Use it to sign every request to this
          webhook (HMAC-SHA256 over the raw body, per <code>docs/prd/universal-outcome-ingestion.md</code> §6.1).
        </p>
      </div>
      <CopyableField label="Webhook URL" value={created.webhook_url} />
      <CopyableField label="Webhook secret" value={created.webhook_secret} />
    </div>
  );
}

function TierStatsRow({ config }: { config: OutcomeSourceConfig }) {
  const { tierStats, loading, loadTierStats, setDeliveryEnabled } = useOutcomesStore();
  const stats = tierStats[config.id];
  const loadingStats = loading[`tier-stats-${config.id}`] ?? false;
  const togglingDelivery = loading[`delivery-enabled-${config.id}`] ?? false;

  useEffect(() => {
    loadTierStats(config.id).catch(() => { /* surfaced via errors[] elsewhere if needed */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id]);

  async function handleToggleDelivery() {
    try {
      await setDeliveryEnabled(config.id, !config.delivery_enabled);
    } catch {
      // no-op — the store already records the error
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-console-border bg-console-chip p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-console-fg flex items-center gap-1.5">
          <Webhook className="h-3.5 w-3.5" /> {outcomesApi.buildWebhookUrl(config.id)}
        </p>
        <Button size="sm" variant="outline" onClick={() => loadTierStats(config.id)} disabled={loadingStats}>
          {loadingStats ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {stats && (
        <dl className="grid grid-cols-4 gap-3 text-xs">
          <div>
            <dt className="text-console-fg-muted">Tier 1 (click ID)</dt>
            <dd className="text-console-fg font-medium">{stats.tier1}</dd>
          </div>
          <div>
            <dt className="text-console-fg-muted">Tier 2 (hashed PII)</dt>
            <dd className="text-console-fg font-medium">{stats.tier2}</dd>
          </div>
          <div>
            <dt className="text-console-fg-muted">Tier 3 (unresolved)</dt>
            <dd className="text-console-fg font-medium">{stats.tier3}</dd>
          </div>
          <div>
            <dt className="text-console-fg-muted">Tier-3 rate</dt>
            <dd className="text-console-fg font-medium">
              {stats.tier3_rate_percent != null ? `${stats.tier3_rate_percent.toFixed(1)}%` : '—'}
            </dd>
          </div>
        </dl>
      )}

      <div className="pt-2 border-t border-console-border flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-console-fg">
            {config.delivery_enabled ? 'Delivery is enabled' : 'Delivery is off'}
          </p>
          {config.delivery_disabled_reason && (
            <p className="text-xs text-severity-warning mt-0.5">{config.delivery_disabled_reason}</p>
          )}
        </div>
        <Button
          size="sm"
          variant={config.delivery_enabled ? 'outline' : 'default'}
          onClick={handleToggleDelivery}
          disabled={togglingDelivery}
        >
          {togglingDelivery ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          {config.delivery_enabled ? 'Disable delivery' : 'Enable delivery'}
        </Button>
      </div>
    </div>
  );
}

export function WebhookSourceCard() {
  const { configs, createWebhookConfig, loading, errors } = useOutcomesStore();
  const { currentOrg } = useOrganisationStore();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [created, setCreated] = useState<CreatedWebhookOutcomeSourceConfig | null>(null);

  const creating = loading['create-webhook-config'] ?? false;
  const createError = errors['create-webhook-config'];
  const webhookConfigs = configs.filter((c) => c.source_type === 'webhook');

  useEffect(() => {
    if (!currentOrg) return;
    clientApi.list(currentOrg.id).then(setClients).catch(() => setClients([]));
  }, [currentOrg]);

  async function handleCreate() {
    if (!selectedClientId) return;
    try {
      const result = await createWebhookConfig({ client_id: selectedClientId });
      setCreated(result);
      setSelectedClientId('');
    } catch {
      // surfaced via createError below
    }
  }

  return (
    <Card className="border-console-border bg-console-surface">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-console-fg">Webhook Source</CardTitle>
        <p className="text-sm text-console-fg-muted">
          Post an <code>OutcomeRecord</code> directly to a per-client endpoint instead of connecting a
          CRM — no OAuth, HMAC-signed, per docs/prd/universal-outcome-ingestion.md §6.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {created && <CreatedSecretPanel created={created} />}

        {webhookConfigs.length > 0 && (
          <div className="space-y-3">
            {webhookConfigs.map((config) => (
              <TierStatsRow key={config.id} config={config} />
            ))}
          </div>
        )}

        <div className="rounded-lg border border-dashed border-console-border p-4 space-y-3">
          <p className="text-sm text-console-fg-muted">Create a new webhook source for a client:</p>
          <div className="flex gap-2">
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                {clients
                  .filter((c) => !webhookConfigs.some((wc) => wc.client_id === c.id))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleCreate} disabled={!selectedClientId || creating} className="flex-shrink-0">
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create
            </Button>
          </div>
          {createError && <p className="text-sm text-severity-critical">{createError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
