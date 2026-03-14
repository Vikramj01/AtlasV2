/**
 * DeploymentWizard — modal to select a signal pack and deploy it to a client.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { signalApi } from '@/lib/api/signalApi';
import { clientApi } from '@/lib/api/organisationApi';
import { PackCard } from './PackCard';
import type { SignalPack } from '@/types/signal';
import type { ClientDeployment } from '@/types/organisation';

interface Props {
  orgId: string;
  clientId: string;
  clientName: string;
  onDeployed: (deployment: ClientDeployment) => void;
  onClose: () => void;
}

export function DeploymentWizard({ orgId, clientId, clientName, onDeployed, onClose }: Props) {
  const [packs, setPacks] = useState<SignalPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
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
      const deployment = await clientApi.deployPack(orgId, clientId, selectedPackId);
      onDeployed(deployment);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <CardContent className="p-6 flex flex-col gap-4 overflow-hidden">
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
              {/* Org packs */}
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

              {/* System packs */}
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
              {isDeploying ? 'Deploying…' : 'Deploy pack'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
