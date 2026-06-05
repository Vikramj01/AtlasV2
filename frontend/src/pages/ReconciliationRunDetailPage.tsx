import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { slackApi } from '@/lib/api/slackApi';
import { ShareToSlackButton } from '@/components/common/ShareToSlackButton';
import { useReconciliationStore } from '@/store/reconciliationStore';
import { FindingsList } from '@/components/reconciliation/FindingsList';
import { ReconciliationRunSummary } from '@/components/reconciliation/ReconciliationRunSummary';
import { DimensionScorePanel } from '@/components/reconciliation/DimensionScorePanel';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import type { ReconciliationFinding } from '@/lib/api/reconciliationApi';

type Dimension = ReconciliationFinding['dimension'];

const DIMENSION_TABS: { key: Dimension; label: string }[] = [
  { key: 'delivery',  label: 'Delivery' },
  { key: 'config',    label: 'Config' },
  { key: 'alignment', label: 'Alignment' },
  { key: 'volume',    label: 'Volume' },
];

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

      {/* Run header + dimension scores */}
      <ReconciliationRunSummary run={currentRun} findings={findings} />
      <DimensionScorePanel findings={findings} />

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

      {/* Actions */}
      <div className="flex justify-between">
        <ShareToSlackButton
          onShare={(destinationId) => slackApi.shareReconciliation(runId!, destinationId).then(() => undefined)}
        />
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
