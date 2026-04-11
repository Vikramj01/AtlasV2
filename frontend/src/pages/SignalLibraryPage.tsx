import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Download, LayoutGrid, List, TreePine, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signalApi } from '@/lib/api/signalApi';
import { healthApi } from '@/lib/api/healthApi';
import { exportApi } from '@/lib/api/exportApi';
import { taxonomyApi } from '@/lib/api/taxonomyApi';
import { useSignalStore } from '@/store/signalStore';
import { useTaxonomyStore } from '@/store/taxonomyStore';
import { SignalCard } from '@/components/signals/SignalCard';
import { SignalEditor } from '@/components/signals/SignalEditor';
import { AddToPackModal } from '@/components/signals/AddToPackModal';
import { TaxonomyTree } from '@/components/signals/TaxonomyTree';
import { CustomEventModal } from '@/components/signals/CustomEventModal';
import { NamingConventionSettings } from '@/components/signals/NamingConventionSettings';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { signalCoverageGuidance } from '@/lib/guidance/metricGuidance';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import type { Signal } from '@/types/signal';
import type { TaxonomyNode } from '@/types/taxonomy';

const CATEGORY_ORDER = ['conversion', 'engagement', 'navigation', 'custom'];

const CATEGORY_LABELS: Record<string, string> = {
  conversion:  'Conversion',
  engagement:  'Engagement',
  navigation:  'Navigation',
  custom:      'Custom',
};

type ViewMode = 'tree' | 'grid' | 'list';

const LS_VIEW_KEY = 'atlas_tracking_map_view';

const NAVY = '#1B2A4A';

export function SignalLibraryPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { signals, setSignals, addSignal, updateSignal, removeSignal } = useSignalStore();
  const { tree, isLoadingTree, convention, setTree, setConvention, setLoadingTree, setLoadingConvention } = useTaxonomyStore();

  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingSignal, setEditingSignal] = useState<Signal | null>(null);
  const [addToPackSignal, setAddToPackSignal] = useState<Signal | null>(null);
  const [signalHealthPct, setSignalHealthPct] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const [showCustomEventModal, setShowCustomEventModal] = useState(false);
  const [showNamingConvention, setShowNamingConvention] = useState(false);

  // ── View toggle (tree | grid | list) persisted to localStorage ────────────
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(LS_VIEW_KEY);
    if (saved === 'grid' || saved === 'list' || saved === 'tree') return saved;
    return 'tree';
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
    if (!orgId) return;
    setLoadingTree(true);
    taxonomyApi.getTree(orgId)
      .then(setTree)
      .catch(() => setTree([]))
      .finally(() => setLoadingTree(false));
  }, [orgId, setTree, setLoadingTree]);

  useEffect(() => {
    if (!orgId) return;
    setLoadingConvention(true);
    taxonomyApi.getConvention(orgId)
      .then(setConvention)
      .catch(() => {})
      .finally(() => setLoadingConvention(false));
  }, [orgId, setConvention, setLoadingConvention]);

  useEffect(() => {
    healthApi.getDashboard()
      .then((d) => setSignalHealthPct(d.score?.signal_health ?? null))
      .catch(() => {});
  }, []);

  // ── Filtering (for grid/list views) ───────────────────────────────────────
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

  function handleTaxonomyAdded(signal: Signal) {
    addSignal(signal);
  }

  function handleCustomEventCreated(_node: TaxonomyNode) {
    // Re-fetch the tree to include the new custom event
    if (orgId) {
      setLoadingTree(true);
      taxonomyApi.getTree(orgId)
        .then(setTree)
        .catch(() => {})
        .finally(() => setLoadingTree(false));
    }
    setShowCustomEventModal(false);
  }

  const existingSignalKeys = signals.map((s) => s.key);

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
          {viewMode !== 'tree' && (
            <Button size="sm" className="gap-2" onClick={() => { setEditingSignal(null); setShowEditor(true); }}>
              <Plus className="h-4 w-4" />
              Custom signal
            </Button>
          )}
        </div>
      </div>

      <MetricGuidance
        result={signalCoverageGuidance(signalHealthPct)}
        collapsible
      />

      {/* ── Controls row ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: search + category pills (only for grid/list views) */}
        {viewMode !== 'tree' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search signals…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />

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
                    <span className="ml-1.5 text-[10px]" style={{ opacity: isActive ? 0.75 : 0.5 }}>
                      {categoryCounts[cat]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          /* Tree view: show signal count summary and convention gear */
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#6B7280]">
              {signals.length} signal{signals.length !== 1 ? 's' : ''} in Tracking Map
            </span>
            {convention && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#1B2A4A] transition-colors"
                onClick={() => setShowNamingConvention(true)}
                title="Naming convention settings"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {convention.event_case}
                {convention.event_prefix ? ` · prefix: ${convention.event_prefix}` : ''}
              </button>
            )}
          </div>
        )}

        {/* Right: view toggle + naming convention gear */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {viewMode !== 'tree' && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-[#9CA3AF] hover:text-[#1B2A4A]"
              onClick={() => setShowNamingConvention(true)}
              title="Naming convention settings"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center rounded-lg border border-[#E5E7EB] p-0.5">
            {([
              { mode: 'tree' as ViewMode, Icon: TreePine, label: 'Taxonomy tree' },
              { mode: 'grid' as ViewMode, Icon: LayoutGrid, label: 'Grid view' },
              { mode: 'list' as ViewMode, Icon: List, label: 'List view' },
            ]).map(({ mode, Icon, label }) => {
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
                  title={label}
                  aria-pressed={isActive}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}

      {/* Tree view */}
      {viewMode === 'tree' && orgId && (
        <TaxonomyTree
          orgId={orgId}
          tree={tree}
          isLoading={isLoadingTree}
          existingSignalKeys={existingSignalKeys}
          onAdded={handleTaxonomyAdded}
          onCreateCustom={() => setShowCustomEventModal(true)}
        />
      )}

      {/* Grid / list views */}
      {viewMode !== 'tree' && (
        <>
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
                  : 'Switch to Tree view to browse the taxonomy and add events to your Tracking Map.'
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
        </>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}

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

      {showCustomEventModal && orgId && (
        <CustomEventModal
          orgId={orgId}
          tree={tree}
          onCreated={handleCustomEventCreated}
          onClose={() => setShowCustomEventModal(false)}
        />
      )}

      {showNamingConvention && orgId && convention && (
        <NamingConventionSettings
          orgId={orgId}
          convention={convention}
          onSaved={(updated) => { setConvention(updated); setShowNamingConvention(false); }}
          onClose={() => setShowNamingConvention(false)}
        />
      )}
    </div>
  );
}
