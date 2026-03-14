import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signalApi } from '@/lib/api/signalApi';
import { useSignalStore } from '@/store/signalStore';
import { SignalCard } from '@/components/signals/SignalCard';
import { SignalEditor } from '@/components/signals/SignalEditor';
import type { Signal } from '@/types/signal';

const CATEGORY_ORDER = ['conversion', 'engagement', 'navigation', 'custom'];

export function SignalLibraryPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { signals, setSignals, addSignal, updateSignal, removeSignal } = useSignalStore();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);

  useEffect(() => {
    if (!orgId) return;
    signalApi.listSignals(orgId)
      .then(setSignals)
      .finally(() => setIsLoading(false));
  }, [orgId, setSignals]);

  const filtered = signals.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.key.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()),
  );

  const grouped = CATEGORY_ORDER.reduce<Record<string, Signal[]>>((acc, cat) => {
    const matches = filtered.filter((s) => s.category === cat);
    if (matches.length > 0) acc[cat] = matches;
    return acc;
  }, {});

  function handleSaved(signal: Signal) {
    if (editingSignal) {
      updateSignal(signal);
    } else {
      addSignal(signal);
    }
    setShowEditor(false);
    setEditingSignal(null);
  }

  async function handleDelete(signal: Signal) {
    if (!signal.organisation_id) return;
    await signalApi.deleteSignal(signal.id);
    removeSignal(signal.id);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Signal Library</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Platform-agnostic event definitions. Build once, deploy to any client.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/org/${orgId}/packs`}>
            <Button variant="outline" size="sm">Signal Packs</Button>
          </Link>
          <Button size="sm" className="gap-2" onClick={() => { setEditingSignal(null); setShowEditor(true); }}>
            <Plus className="h-4 w-4" />
            Custom signal
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search signals…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No signals found.</p>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([category, categorySignals]) => (
            <div key={category}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {category}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {categorySignals.map((signal) => (
                  <SignalCard
                    key={signal.id}
                    signal={signal}
                    onEdit={(s) => { setEditingSignal(s); setShowEditor(true); }}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showEditor && orgId && (
        <SignalEditor
          orgId={orgId}
          signal={editingSignal}
          onSaved={handleSaved}
          onClose={() => { setShowEditor(false); setEditingSignal(null); }}
        />
      )}
    </div>
  );
}
