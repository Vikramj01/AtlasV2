import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Download, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signalApi } from '@/lib/api/signalApi';
import { healthApi } from '@/lib/api/healthApi';
import { exportApi } from '@/lib/api/exportApi';
import { useSignalStore } from '@/store/signalStore';
import { SignalCard } from '@/components/signals/SignalCard';
import { SignalEditor } from '@/components/signals/SignalEditor';
import { AddToPackModal } from '@/components/signals/AddToPackModal';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { signalCoverageGuidance } from '@/lib/guidance/metricGuidance';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { Signal } from '@/types/signal';

const CATEGORY_ORDER = ['conversion', 'engagement', 'navigation', 'custom'];

const CATEGORY_LABELS: Record<string, string> = {
  conversion:  'Conversion',
  engagement:  'Engagement',
  navigation:  'Navigation',
  custom:      'Custom',
};

type ViewMode = 'grid' | 'list';

const LS_VIEW_KEY = 'atlas_tracking_map_view';

const NAVY = '#1B2A4A';

export function SignalLibraryPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { signals, setSignals, addSignal, updateSignal, removeSignal } = useSignalStore();
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);
  const [addToPackSignal, setAddToPackSignal] = useState<Signal | null>(null);
  const [signalHealthPct, setSignalHealthPct] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── View toggle (grid | list) persisted to localStorage ───────────────────
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(LS_VIEW_KEY);
    return saved === 'list' ? 'list' : 'grid';
  });

  function toggleView(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(LS_VIEW_KEY, mode);
  }

  // ── Category pill filters (multi-select) ──────────────────────────────────
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());

  function toggleCategory(cat: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function clearCategories() {
    setActiveCategories(new Set());
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function handleExport() {
    setExporting(true);
    try {
      await exportApi.downloadSignalInventory(orgId);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if (!orgId) return;
    signalApi.listSignals(orgId)
      .then(setSignals)
      .finally(() => setIsLoading(false));
  }, [orgId, setSignals]);

  useEffect(() => {
    healthApi.getDashboard()
      .then((d) => setSignalHealthPct(d.score?.signal_health ?? null))
      .catch(() => {});
  }, []);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = signals.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.key.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory =
      activeCategories.size === 0 || activeCategories.has(s.category);
    return matchesSearch && matchesCategory;
  });

  const grouped = CATEGORY_ORDER.reduce<Record<string, Signal[]>>((acc, cat) => {
    const matches = filtered.filter((s) => s.category === cat);
    if (matches.length > 0) acc[cat] = matches;
    return acc;
  }, {});

  // ── Derived counts for filter pills ───────────────────────────────────────
  const categoryCounts = CATEGORY_ORDER.reduce<Record<string, number>>((acc, cat) => {
    acc[cat] = signals.filter((s) => s.category === cat).length;
    return acc;
  }, {});

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSaved(signal: Signal) {
    if (editingSignal) updateSignal(signal);
    else addSignal(signal);
    setShowEditor(false);
    setEditingSignal(null);
  }

  async function handleDelete(signal: Signal) {
    if (!signal.organisation_id) return;
    await signalApi.deleteSignal(signal.id);
    removeSignal(signal.id);
  }

  return (
    <div className="px-6 py-8 max-w-5xl space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title">Tracking Map</h1>
          <p className="text-body text-[#6B7280] mt-0.5">
            Platform-agnostic event definitions. Build once, deploy to any client.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to={`/org/${orgId}/packs`}>
            <Button variant="secondary" size="sm">Templates</Button>
          </Link>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting…' : 'Export XLSX'}
          </Button>
          <Button size="sm" className="gap-2" onClick={() => { setEditingSignal(null); setShowEditor(true); }}>
            <Plus className="h-4 w-4" />
            Custom signal
          </Button>
        </div>
      </div>

      <MetricGuidance
        result={signalCoverageGuidance(signalHealthPct)}
        collapsible
      />

      {/* ── Search + filters + view toggle row ───────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: search + category pills */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search signals…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />

          {/* "All" pill */}
          <button
            type="button"
            onClick={clearCategories}
            className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            style={
              activeCategories.size === 0
                ? { backgroundColor: NAVY, borderColor: NAVY, color: '#fff' }
                : { backgroundColor: '#fff', borderColor: '#E5E7EB', color: '#6B7280' }
            }
          >
            All
          </button>

          {CATEGORY_ORDER.map((cat) => {
            const isActive = activeCategories.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                style={
                  isActive
                    ? { backgroundColor: NAVY, borderColor: NAVY, color: '#fff' }
                    : { backgroundColor: '#fff', borderColor: '#E5E7EB', color: '#6B7280' }
                }
              >
                {CATEGORY_LABELS[cat]}
                {categoryCounts[cat] > 0 && (
                  <span
                    className="ml-1.5 text-[10px]"
                    style={{ opacity: isActive ? 0.75 : 0.5 }}
                  >
                    {categoryCounts[cat]}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: view toggle */}
        <div className="flex items-center rounded-lg border border-[#E5E7EB] p-0.5 self-start sm:self-auto">
          {(['grid', 'list'] as ViewMode[]).map((mode) => {
            const Icon = mode === 'grid' ? LayoutGrid : List;
            const isActive = viewMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => toggleView(mode)}
                className="flex h-7 w-7 items-center justify-center rounded transition-colors"
                style={
                  isActive
                    ? { backgroundColor: NAVY, color: '#fff' }
                    : { color: '#9CA3AF' }
                }
                title={mode === 'grid' ? 'Grid view' : 'List view'}
                aria-pressed={isActive}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} variant="card" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState
          icon="signals"
          title={search || activeCategories.size > 0 ? 'No signals match your filter' : 'No signals yet'}
          description={
            search || activeCategories.size > 0
              ? 'Try adjusting your search or clearing the category filters.'
              : 'Add your first custom signal or load a template to get started.'
          }
          action={
            activeCategories.size > 0 ? (
              <Button variant="secondary" onClick={clearCategories}>Clear filters</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([category, categorySignals]) => (
            <div key={category}>
              <h2 className="text-caption-upper mb-3">
                {CATEGORY_LABELS[category] ?? category}
                <span className="ml-2 text-[#9CA3AF]">({categorySignals.length})</span>
              </h2>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {categorySignals.map((signal) => (
                    <SignalCard
                      key={signal.id}
                      signal={signal}
                      view="grid"
                      onEdit={(s) => { setEditingSignal(s); setShowEditor(true); }}
                      onDelete={handleDelete}
                      onAddToPack={(s) => setAddToPackSignal(s)}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-[#E5E7EB] overflow-hidden">
                  {categorySignals.map((signal, i) => (
                    <SignalCard
                      key={signal.id}
                      signal={signal}
                      view="list"
                      className={i < categorySignals.length - 1 ? 'border-b border-[#E5E7EB]' : ''}
                      onEdit={(s) => { setEditingSignal(s); setShowEditor(true); }}
                      onDelete={handleDelete}
                      onAddToPack={(s) => setAddToPackSignal(s)}
                    />
                  ))}
                </div>
              )}
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

      {addToPackSignal && orgId && (
        <AddToPackModal
          signal={addToPackSignal}
          orgId={orgId}
          onClose={() => setAddToPackSignal(null)}
        />
      )}
    </div>
  );
}
