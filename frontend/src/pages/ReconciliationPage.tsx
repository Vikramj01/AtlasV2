import { useEffect, useState, type ElementType } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, XCircle, AlertTriangle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReconciliationStore } from '@/store/reconciliationStore';
import { AlignmentMatrix } from '@/components/reconciliation/AlignmentMatrix';
import { DimensionScorePanel } from '@/components/reconciliation/DimensionScorePanel';
import { ToleranceConfigPanel } from '@/components/reconciliation/ToleranceConfigPanel';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import type { ReconciliationRun, ReconciliationFinding } from '@/lib/api/reconciliationApi';

type RunStatus = ReconciliationRun['status'];

const STATUS_CONFIG: Record<RunStatus, { label: string; cls: string; icon: ElementType }> = {
  running:   { label: 'Running',   cls: 'bg-blue-100 text-blue-700',  icon: RefreshCw },
  succeeded: { label: 'Succeeded', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  partial:   { label: 'Partial',   cls: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700',     icon: XCircle },
};

const RUN_TYPE_LABELS: Record<string, string> = {
  scheduled:       'Scheduled',
  manual:          'Manual',
  post_brief_lock: 'Post-lock',
};

// ── 30-day trend chart (CSS bars, no chart library) ──────────────────────────

interface TrendBucket {
  label: string;    // DD/MM
  count: number;
}

function buildTrendBuckets(runs: ReconciliationRun[]): TrendBucket[] {
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;

  const bucketMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    bucketMap.set(key, 0);
  }

  for (const run of runs) {
    const ts = new Date(run.started_at).getTime();
    if (ts < cutoff) continue;
    const d = new Date(ts);
    const key = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (bucketMap.has(key)) {
      bucketMap.set(key, (bucketMap.get(key) ?? 0) + run.total_findings);
    }
  }

  return Array.from(bucketMap.entries()).map(([label, count]) => ({ label, count }));
}

function TrendChart({ runs }: { runs: ReconciliationRun[] }) {
  const buckets = buildTrendBuckets(runs);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  // Show every 5th label to avoid crowding
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">30-day findings trend</p>
      <div className="flex items-end gap-0.5 h-20">
        {buckets.map((b, i) => {
          const heightPct = maxCount > 0 ? (b.count / maxCount) * 100 : 0;
          return (
            <div key={b.label} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={`${b.label}: ${b.count} findings`}>
              <div
                className="w-full rounded-sm bg-[#1B2A4A] opacity-70 transition-all duration-300"
                style={{ height: heightPct > 0 ? `${Math.max(heightPct, 4)}%` : '2px', minHeight: '2px' }}
              />
              {i % 5 === 0 && (
                <span className="text-[8px] text-[#9CA3AF] leading-none">{b.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-[#9CA3AF]">Findings per run, last 30 days</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReconciliationPage() {
  return (
    <SectionErrorBoundary label="Reconciliation">
      <ReconciliationPageInner />
    </SectionErrorBoundary>
  );
}

function ReconciliationPageInner() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const {
    runs,
    findings,
    loading,
    triggering,
    fetchRuns,
    triggerRun,
    fetchRunDetail,
  } = useReconciliationStore();
  const [pollingTimeout, setPollingTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!clientId) return;
    fetchRuns(clientId).then(() => {
      // Pre-load findings for the latest run to power DimensionScorePanel
    });
    return () => {
      if (pollingTimeout) clearTimeout(pollingTimeout);
    };
  }, [clientId, fetchRuns]);

  // Load findings for the latest completed run to power DimensionScorePanel
  useEffect(() => {
    const latestDone = runs.find((r) => r.status !== 'running');
    if (latestDone) fetchRunDetail(latestDone.id);
  }, [runs, fetchRunDetail]);

  async function handleRunNow() {
    if (!clientId) return;
    await triggerRun(clientId);
    const t = setTimeout(() => fetchRuns(clientId), 4000);
    setPollingTimeout(t);
  }

  const latestRun = runs[0] ?? null;
  const totalOpenFindings = findings.filter((f: ReconciliationFinding) => f.resolved_at === null).length;

  if (!clientId) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-[#9CA3AF]">Select a client to view reconciliation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B2A4A]">Platform Reconciliation</h1>
          {latestRun && (
            <p className="text-xs text-[#9CA3AF] mt-0.5">
              Last run {new Date(latestRun.started_at).toLocaleString()}
              {latestRun.status === 'running' && ' · Running…'}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunNow}
          disabled={triggering || latestRun?.status === 'running'}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${triggering || latestRun?.status === 'running' ? 'animate-spin' : ''}`} />
          Run now
        </Button>
      </div>

      {/* Open findings summary chips */}
      {totalOpenFindings > 0 && (
        <div className="flex gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">
            <XCircle className="h-3 w-3" />
            {totalOpenFindings} open finding{totalOpenFindings === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Dimension scores (only when findings loaded) */}
      {findings.length > 0 && <DimensionScorePanel findings={findings} />}

      {/* 30-day trend chart */}
      {runs.length > 0 && <TrendChart runs={runs} />}

      {/* Latest alignment matrix (only when brief_id is on the latest run) */}
      {latestRun?.brief_id ? (
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Latest alignment</p>
          <AlignmentMatrix
            briefId={latestRun.brief_id}
            clientId={clientId}
            objectives={[]}
          />
        </div>
      ) : (
        !loading && runs.length === 0 && (
          <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-10 text-center">
            <AlertTriangle className="h-6 w-6 text-[#9CA3AF] mx-auto mb-3" />
            <p className="text-sm text-[#9CA3AF]">
              No reconciliation data yet. Click "Run now" to start.
            </p>
          </div>
        )
      )}

      {/* Run history table */}
      {runs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Run history</p>
          <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280]">Started</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280]">Type</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280]">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-[#6B7280]">Platforms</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-[#6B7280]">Findings</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {runs.map((run: ReconciliationRun) => {
                  const cfg = STATUS_CONFIG[run.status];
                  const Icon = cfg.icon;
                  return (
                    <tr key={run.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-4 py-3 text-[#1B2A4A] text-xs">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-[#6B7280] text-xs">
                        {RUN_TYPE_LABELS[run.run_type] ?? run.run_type}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.cls}`}>
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6B7280] text-xs">
                        {run.platforms_run.join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {run.total_findings > 0 ? (
                          <span className="font-medium text-[#1B2A4A]">{run.total_findings}</span>
                        ) : (
                          <span className="text-[#9CA3AF]">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => navigate(`/reconciliation/runs/${run.id}`)}
                          className="text-xs text-[#1B2A4A] hover:underline inline-flex items-center gap-0.5"
                        >
                          View <ChevronRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tolerance config */}
      <ToleranceConfigPanel clientId={clientId} />
    </div>
  );
}
