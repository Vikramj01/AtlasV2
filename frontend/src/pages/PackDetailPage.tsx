import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { signalApi } from '@/lib/api/signalApi';
import { SignalCard } from '@/components/signals/SignalCard';
import { PackDeploymentView } from '@/components/signals/PackDeploymentView';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { SignalPackWithSignals } from '@/types/signal';

export function PackDetailPage() {
  const { orgId, packId } = useParams<{ orgId: string; packId: string }>();
  const [pack, setPack] = useState<(SignalPackWithSignals & { client_count: number; outdated_count: number }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenResult, setRegenResult] = useState<{ regenerated: number; failed: number; total: number } | null>(null);

  useEffect(() => {
    if (!packId) return;
    signalApi.getPack(packId)
      .then(setPack)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [packId]);

  async function handleRemoveSignal(signalId: string) {
    if (!packId || !pack) return;
    await signalApi.removeSignalFromPack(packId, signalId);
    setPack((p) => p ? {
      ...p,
      signals: p.signals.filter((s) => s.signal_id !== signalId),
      signals_count: p.signals_count - 1,
      version: p.version + 1,
      outdated_count: p.client_count, // all clients now outdated after version bump
    } : p);
  }

  async function handleRegenerateAll() {
    if (!packId || !orgId) return;
    setIsRegenerating(true);
    setRegenResult(null);
    try {
      const result = await signalApi.regenerateAllForPack(packId, orgId);
      setRegenResult(result);
      // Reset outdated count optimistically
      setPack((p) => p ? { ...p, outdated_count: result.failed } : p);
    } catch (err) {
      setRegenResult({ regenerated: 0, failed: pack?.client_count ?? 0, total: pack?.client_count ?? 0 });
    } finally {
      setIsRegenerating(false);
    }
  }

  if (isLoading) {
    return <SkeletonCard variant="page" />;
  }
  if (!pack || error) {
    return <div className="p-6 text-sm text-red-600">{error ?? 'Pack not found.'}</div>;
  }

  const hasClients = pack.client_count > 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{pack.name}</h1>
            {pack.is_system && <Badge variant="secondary" className="text-xs">System</Badge>}
            <Badge variant="outline" className="text-xs">v{pack.version}</Badge>
          </div>
          {pack.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{pack.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {pack.signals_count} signals · {pack.client_count} client{pack.client_count !== 1 ? 's' : ''} deployed
          </p>
        </div>
        <div className="flex gap-2">
          {hasClients && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-xs"
              disabled={isRegenerating}
              onClick={handleRegenerateAll}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
              {isRegenerating ? 'Regenerating…' : `Regenerate all (${pack.client_count})`}
            </Button>
          )}
          {!pack.is_system && (
            <Link to={`/org/${orgId}/signals`}>
              <Button size="sm" variant="outline" className="gap-2 text-xs">
                <Plus className="h-3.5 w-3.5" />
                Add signal
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Outdated clients warning */}
      {pack.outdated_count > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              {pack.outdated_count} of {pack.client_count} client{pack.client_count !== 1 ? 's' : ''} need{pack.outdated_count === 1 ? 's' : ''} to regenerate outputs
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              This pack was updated (v{pack.version}) but some clients haven't regenerated their GTM container and dataLayer spec yet.
              Click <strong>Regenerate all</strong> to push the latest signals to all clients at once.
            </p>
          </div>
        </div>
      )}

      {/* Regeneration result feedback */}
      {regenResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${regenResult.failed === 0 ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {regenResult.failed === 0
            ? `✓ Regenerated outputs for all ${regenResult.regenerated} client${regenResult.regenerated !== 1 ? 's' : ''} successfully.`
            : `Regenerated ${regenResult.regenerated} of ${regenResult.total} clients. ${regenResult.failed} failed — check those clients individually.`}
        </div>
      )}

      {/* Info banner when all clients are up to date */}
      {hasClients && pack.outdated_count === 0 && !regenResult && (
        <div className="rounded-lg border border-muted bg-muted/30 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <strong>{pack.client_count} client{pack.client_count !== 1 ? 's' : ''}</strong> use this pack and all outputs are up to date (v{pack.version}).
            Adding or removing signals will mark their outputs as outdated.
          </p>
        </div>
      )}

      {/* Client deployments */}
      {orgId && <PackDeploymentView packId={pack.id} orgId={orgId} />}

      {/* Signals */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Signals in this pack</h2>
        {pack.signals.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No signals yet.</p>
              {!pack.is_system && (
                <Link to={`/org/${orgId}/signals`}>
                  <Button size="sm" variant="outline" className="mt-3">Browse event catalogue</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pack.signals.map((ps) => ps.signal && (
              <div key={ps.id} className="relative">
                <SignalCard signal={ps.signal} />
                {!pack.is_system && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-red-600"
                    onClick={() => handleRemoveSignal(ps.signal_id)}
                    title="Remove from pack"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {ps.stage_hint && (
                  <div className="absolute bottom-2 right-2">
                    <Badge variant="outline" className="text-[10px]">{ps.stage_hint}</Badge>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
