import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { signalApi } from '@/lib/api/signalApi';
import { SignalCard } from '@/components/signals/SignalCard';
import { WalkerOSAdvantageCard } from '@/components/signals/WalkerOSAdvantageCard';
import type { SignalPackWithSignals } from '@/types/signal';

export function PackDetailPage() {
  const { orgId, packId } = useParams<{ orgId: string; packId: string }>();
  const [pack, setPack] = useState<(SignalPackWithSignals & { client_count: number }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } : p);
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>;
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
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate all ({pack.client_count})
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

      {/* Version warning */}
      {hasClients && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-800">
            <strong>{pack.client_count} client{pack.client_count !== 1 ? 's' : ''}</strong> use this pack.
            When you modify signals here, click <strong>Regenerate all</strong> to update their outputs.
          </p>
        </div>
      )}

      {/* WalkerOS advantage */}
      <WalkerOSAdvantageCard deploymentCount={pack.client_count} context="pack" />

      {/* Signals */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Signals in this pack</h2>
        {pack.signals.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No signals yet.</p>
              {!pack.is_system && (
                <Link to={`/org/${orgId}/signals`}>
                  <Button size="sm" variant="outline" className="mt-3">Browse Signal Library</Button>
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
