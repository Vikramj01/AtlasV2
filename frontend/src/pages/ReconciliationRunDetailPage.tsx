import { useEffect, useState, type ElementType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReconciliationStore } from '@/store/reconciliationStore';
import { FindingsList } from '@/components/reconciliation/FindingsList';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import type { ReconciliationFinding } from '@/lib/api/reconciliationApi';

type Dimension = ReconciliationFinding['dimension'];

const DIMENSION_TABS: { key: Dimension; label: string }[] = [
  { key: 'delivery',  label: 'Delivery' },
  { key: 'config',    label: 'Config' },
  { key: 'alignment', label: 'Alignment' },
  { key: 'volume',    label: 'Volume' },
];

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: ElementType }> = {
  running:   { label: 'Running',   cls: 'bg-blue-100 text-blue-700',   icon: RefreshCw },
  succeeded: { label: 'Succeeded', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  partial:   { label: 'Partial',   cls: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700',     icon: XCircle },
};

const RUN_TYPE_LABELS: Record<string, string> = {
  scheduled:       'Scheduled run',
  manual:          'Manual run',
  post_brief_lock: 'Post-lock run',
};

export function ReconciliationRunDetailPage() {
  return (
    <SectionErrorBoundary label="Reconciliation run detail">
      <ReconciliationRunDetailPageInner />
    </SectionErrorBoundary>
  );
}

function ReconciliationRunDetailPageInner() {
  const { id: runId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentRun,
    findings,
    filters,
    loading,
    fetchRunDetail,
    setFilters,
    resolveFinding,
  } = useReconciliationStore();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Dimension>('delivery');

  useEffect(() => {
    if (runId) fetchRunDetail(runId);
  }, [runId, fetchRunDetail]);

  async function handleResolve(findingId: string) {
    setResolvingId(findingId);
    await resolveFinding(findingId);
    setResolvingId(null);
  }

  const tabFindings = findings.filter((f: ReconciliationFinding) => f.dimension === activeTab);

  // Count open findings per dimension for tab badges
  const countsByDimension = findings.reduce((acc: Record<string, number>, f: ReconciliationFinding) => {
    if (f.resolved_at === null) acc[f.dimension] = (acc[f.dimension] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading && !currentRun) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <RefreshCw className="h-5 w-5 animate-spin text-[#9CA3AF]" />
      </div>
    );
  }

  if (!currentRun) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-[#9CA3AF]">Run not found.</p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[currentRun.status] ?? STATUS_CONFIG.failed;
  const StatusIcon = statusCfg.icon;

  const durationMs = currentRun.finished_at
    ? new Date(currentRun.finished_at).getTime() - new Date(currentRun.started_at).getTime()
    : null;
  const durationLabel = durationMs !== null
    ? durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`
    : 'In progress';

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1B2A4A]"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </button>

      {/* Run header */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wide">
              {RUN_TYPE_LABELS[currentRun.run_type] ?? currentRun.run_type}
            </p>
            <p className="text-sm text-[#1B2A4A] mt-0.5">
              {new Date(currentRun.started_at).toLocaleString()}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${statusCfg.cls}`}>
            <StatusIcon className="h-3.5 w-3.5" />
            {statusCfg.label}
          </span>
        </div>

        <div className="flex items-center gap-4 flex-wrap text-xs text-[#6B7280]">
          <span>Duration: <strong className="text-[#1B2A4A]">{durationLabel}</strong></span>
          <span>Platforms: <strong className="text-[#1B2A4A]">{currentRun.platforms_run.join(', ') || '—'}</strong></span>
          <span>Total findings: <strong className="text-[#1B2A4A]">{currentRun.total_findings}</strong></span>
        </div>

        {currentRun.error_summary && (
          <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{currentRun.error_summary}</p>
        )}
      </div>

      {/* Dimension tabs */}
      <div className="space-y-3">
        <div className="flex gap-1 border-b border-[#E5E7EB]">
          {DIMENSION_TABS.map((tab) => {
            const count = countsByDimension[tab.key] ?? 0;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-[#1B2A4A] text-[#1B2A4A]'
                    : 'border-transparent text-[#6B7280] hover:text-[#1B2A4A]'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <FindingsList
          findings={tabFindings}
          filters={{ ...filters, dimension: activeTab }}
          onFilterChange={(f) => setFilters({ ...f, dimension: activeTab })}
          onResolve={handleResolve}
          resolvingId={resolvingId}
          showFilters={true}
        />
      </div>

      {/* "Re-run" button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(-1)}
          className="gap-1.5"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to client
        </Button>
      </div>
    </div>
  );
}
