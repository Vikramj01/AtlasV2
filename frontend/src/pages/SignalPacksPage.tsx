import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { signalApi } from '@/lib/api/signalApi';
import { useSignalStore } from '@/store/signalStore';
import { PackCard } from '@/components/signals/PackCard';
import { PackEditor } from '@/components/signals/PackEditor';
import type { SignalPack } from '@/types/signal';

export function SignalPacksPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { packs, setPacks, addPack } = useSignalStore();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    signalApi.listPacks(orgId)
      .then(setPacks)
      .finally(() => setIsLoading(false));
  }, [orgId, setPacks]);

  const systemPacks = packs.filter((p) => p.is_system && p.name.toLowerCase().includes(search.toLowerCase()));
  const orgPacks = packs.filter((p) => !p.is_system && p.name.toLowerCase().includes(search.toLowerCase()));

  function handleCreated(pack: SignalPack) {
    addPack(pack);
    setShowEditor(false);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Tracking kits</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reusable signal collections. Deploy to multiple clients at once.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowEditor(true)}>
          <Plus className="h-4 w-4" />
          New pack
        </Button>
      </div>

      <Input
        placeholder="Search packs…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : (
        <div className="space-y-8">
          {orgPacks.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Your packs
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {orgPacks.map((pack) => (
                  <PackCard key={pack.id} pack={pack} orgId={orgId!} />
                ))}
              </div>
            </div>
          )}

          {systemPacks.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Atlas system packs
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {systemPacks.map((pack) => (
                  <PackCard key={pack.id} pack={pack} orgId={orgId!} />
                ))}
              </div>
            </div>
          )}

          {packs.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No tracking kits yet.</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowEditor(true)}>
                  Create your first pack
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {showEditor && orgId && (
        <PackEditor orgId={orgId} onCreated={handleCreated} onClose={() => setShowEditor(false)} />
      )}
    </div>
  );
}
