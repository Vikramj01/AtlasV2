/**
 * AddToPackModal
 *
 * Lets a user add a single signal to one or more packs from the Signal Library.
 * Each pack row has its own async "Add" / "Added ✓" / "Error" state so the user
 * can add to multiple packs in one sitting without reopening.
 *
 * Sprint 4 — Integration & Polish
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { signalApi } from '@/lib/api/signalApi';
import type { Signal, SignalPack } from '@/types/signal';

// ── Types ─────────────────────────────────────────────────────────────────────

type PackRowStatus = 'idle' | 'adding' | 'added' | 'error';

interface Props {
  signal: Signal;
  orgId: string;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddToPackModal({ signal, orgId, onClose }: Props) {
  const [packs, setPacks] = useState<SignalPack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, PackRowStatus>>({});

  useEffect(() => {
    signalApi
      .listPacks(orgId)
      .then(setPacks)
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setIsLoading(false));
  }, [orgId]);

  async function handleAdd(pack: SignalPack) {
    setRowStatus((s) => ({ ...s, [pack.id]: 'adding' }));
    try {
      await signalApi.addSignalToPack(pack.id, signal.id);
      setRowStatus((s) => ({ ...s, [pack.id]: 'added' }));
    } catch {
      setRowStatus((s) => ({ ...s, [pack.id]: 'error' }));
    }
  }

  const orgPacks = packs.filter((p) => !p.is_system);
  const systemPacks = packs.filter((p) => p.is_system);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="flex w-full max-w-lg flex-col overflow-hidden" style={{ maxHeight: '85vh' }}>
        <CardContent className="flex flex-col gap-4 overflow-hidden p-6">
          {/* Header */}
          <div>
            <h2 className="text-base font-bold">Add to pack</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Adding <span className="font-medium text-foreground">{signal.name}</span> to a pack will
              include it in all future output generations for clients that use that pack.
            </p>
          </div>

          {/* Body */}
          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            </div>
          )}

          {loadError && (
            <p className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{loadError}</p>
          )}

          {!isLoading && !loadError && packs.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No packs yet. Create a pack on the Signal Packs page first.
            </p>
          )}

          {!isLoading && packs.length > 0 && (
            <div className="overflow-y-auto flex-1 space-y-5">
              {orgPacks.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Your packs
                  </p>
                  <div className="space-y-2">
                    {orgPacks.map((pack) => (
                      <PackRow
                        key={pack.id}
                        pack={pack}
                        status={rowStatus[pack.id] ?? 'idle'}
                        onAdd={() => handleAdd(pack)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {systemPacks.length > 0 && (
                <section>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Atlas system packs
                  </p>
                  <div className="space-y-2">
                    {systemPacks.map((pack) => (
                      <PackRow
                        key={pack.id}
                        pack={pack}
                        status={rowStatus[pack.id] ?? 'idle'}
                        onAdd={() => handleAdd(pack)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="border-t pt-4">
            <Button variant="ghost" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── PackRow ───────────────────────────────────────────────────────────────────

function PackRow({
  pack,
  status,
  onAdd,
}: {
  pack: SignalPack;
  status: PackRowStatus;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{pack.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {pack.signals_count} signal{pack.signals_count !== 1 ? 's' : ''} · {pack.business_type}
          </p>
        </div>
        {pack.is_system && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">System</Badge>
        )}
      </div>

      <div className="shrink-0">
        {status === 'added' ? (
          <span className="flex items-center gap-1 text-xs font-medium text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Added
          </span>
        ) : status === 'error' ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-red-600 hover:text-red-700"
            onClick={onAdd}
          >
            Retry
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={status === 'adding'}
            onClick={onAdd}
          >
            {status === 'adding' ? 'Adding…' : 'Add'}
          </Button>
        )}
      </div>
    </div>
  );
}
