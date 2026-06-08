/**
 * DeploymentWizard — modal to select a signal pack, deploy it, then configure
 * signal enrichment (value fields, identity mapping, dedup IDs).
 *
 * Step 1: Select pack → Deploy
 * Step 2: Signal Enrichment (skippable)
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { signalApi } from '@/lib/api/signalApi';
import { clientApi } from '@/lib/api/organisationApi';
import { enrichmentApi } from '@/lib/api/enrichmentApi';
import { SignalEnrichmentStep } from '@/components/enrichment/SignalEnrichmentStep';
import type { SignalPack } from '@/types/signal';
import type { ClientDeployment } from '@/types/organisation';
import type { SaveSignalEnrichmentRequest } from '@/types/enrichment';

interface Props {
  orgId: string;
  clientId: string;
  clientName: string;
  onDeployed: (deployment: ClientDeployment) => void;
  onClose: () => void;
}

const CONVERSION_SIGNAL_KEYS = new Set([
  'purchase', 'begin_checkout', 'generate_lead', 'sign_up', 'subscribe',
  'in_store_purchase', 'crm_conversion',
]);

// Signals that need a Google Store Sales allowlisting warning in the enrichment step
const STORE_SALES_SIGNAL_KEYS = new Set(['in_store_purchase']);

export function DeploymentWizard({ orgId, clientId, clientName, onDeployed, onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [packs, setPacks] = useState<SignalPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<ClientDeployment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    signalApi.listPacks(orgId)
      .then(setPacks)
      .finally(() => setIsLoading(false));
  }, [orgId]);

  async function handleDeploy() {
    if (!selectedPackId) return;
    setIsDeploying(true);
    setError(null);
    try {
      const dep = await clientApi.deployPack(orgId, clientId, selectedPackId);
      setDeployment(dep);

      // Only show enrichment step if the pack contains conversion signals
      const selectedPack = packs.find((p) => p.id === selectedPackId);
      const hasConversionSignals = selectedPack?.signals_count && selectedPack.signals_count > 0;
      if (hasConversionSignals) {
        setStep(2);
      } else {
        onDeployed(dep);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  }

  async function handleSaveEnrichment(configs: SaveSignalEnrichmentRequest[]) {
    await Promise.all(
      configs.map((req) =>
        enrichmentApi.saveSignalEnrichment(orgId, clientId, req.deployment_id, req.signal_key, req),
      ),
    );
    onDeployed(deployment!);
  }

  function handleSkipEnrichment() {
    onDeployed(deployment!);
  }

  // Build conversion signals list from the selected pack for step 2.
  // Uses the pack's signal list if available, otherwise falls back to all known conversion keys.
  const selectedPack = packs.find((p) => p.id === selectedPackId);
  const conversionSignals = step === 2 && deployment && selectedPack
    ? (selectedPack.signal_keys ?? [])
        .filter((key: string) => CONVERSION_SIGNAL_KEYS.has(key))
        .map((key: string) => ({
          signal_key: key,
          signal_name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          platform_mappings: {},
          current_config: null,
        }))
    : [];

  // Whether the selected pack contains a signal that needs the Store Sales allowlisting warning
  const hasStoreSalesSignal = selectedPack?.signal_keys?.some((k: string) =>
    STORE_SALES_SIGNAL_KEYS.has(k),
  ) ?? false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <CardContent className="p-6 flex flex-col gap-4 overflow-y-auto">

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {([1, 2] as const).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>

          {/* ── Step 1: Select pack ── */}
          {step === 1 && (
            <>
              <div>
                <h2 className="text-base font-bold">Deploy signal pack to {clientName}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select a pack to deploy. All signals in the pack will be used for output generation and audits.
                </p>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                </div>
              ) : (
                <div className="overflow-y-auto flex-1 space-y-6">
                  {packs.filter((p) => !p.is_system).length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your packs</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {packs.filter((p) => !p.is_system).map((pack) => (
                          <button
                            key={pack.id}
                            type="button"
                            onClick={() => setSelectedPackId(pack.id)}
                            className={`text-left rounded-lg border-2 transition-colors ${
                              selectedPackId === pack.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                            }`}
                          >
                            <div className="p-3">
                              <p className="text-xs font-semibold">{pack.name}</p>
                              <p className="text-xs text-muted-foreground">{pack.signals_count} signals · {pack.business_type}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Atlas system packs</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {packs.filter((p) => p.is_system).map((pack) => (
                        <button
                          key={pack.id}
                          type="button"
                          onClick={() => setSelectedPackId(pack.id)}
                          className={`text-left rounded-lg border-2 transition-colors ${
                            selectedPackId === pack.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
                          }`}
                        >
                          <div className="p-3">
                            <p className="text-xs font-semibold">{pack.name}</p>
                            <p className="text-xs text-muted-foreground">{pack.signals_count} signals · {pack.business_type}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}

              <div className="flex justify-between border-t pt-4">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button onClick={handleDeploy} disabled={!selectedPackId || isDeploying}>
                  {isDeploying ? 'Deploying…' : 'Deploy pack →'}
                </Button>
              </div>
            </>
          )}

          {/* ── Step 2: Signal Enrichment ── */}
          {step === 2 && deployment && (
            <>
              {hasStoreSalesSignal && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                  <span className="font-semibold">Google Store Sales eligibility required</span>
                  {' — '}
                  This pack includes an in-store purchase signal. Google Store Sales requires your account
                  to be allowlisted by Google. Contact your Google rep to confirm eligibility before enabling
                  the Google destination for this signal.
                </div>
              )}
              <SignalEnrichmentStep
                deploymentId={deployment.id}
                conversionSignals={conversionSignals}
                onSave={handleSaveEnrichment}
                onBack={() => setStep(1)}
                onSkip={handleSkipEnrichment}
                onValidatePath={(path) =>
                  enrichmentApi.validateFieldPath(orgId, clientId, { field_path: path })
                }
              />
            </>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
