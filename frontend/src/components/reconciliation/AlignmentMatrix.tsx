import { useEffect, useState, type ElementType } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReconciliationStore } from '@/store/reconciliationStore';
import { FindingsList } from './FindingsList';
import type { ReconciliationFinding } from '@/lib/api/reconciliationApi';

const PLATFORMS = ['google_ads', 'meta', 'ga4'] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABELS: Record<Platform, string> = {
  google_ads: 'Google Ads',
  meta:       'Meta',
  ga4:        'GA4',
};

interface AlignmentMatrixProps {
  briefId: string;
  clientId: string;
  objectives: { id: string; name: string }[];
}

type CellStatus = 'ok' | 'warning' | 'error' | 'no-data';

function getCellStatus(
  objectiveId: string,
  platform: string,
  findings: ReconciliationFinding[],
): CellStatus {
  const relevant = findings.filter(
    (f) => f.objective_id === objectiveId && f.platform === platform && f.resolved_at === null,
  );
  if (relevant.length === 0) return 'no-data';
  if (relevant.some((f) => f.severity === 'critical' || f.severity === 'error')) return 'error';
  if (relevant.some((f) => f.severity === 'warning')) return 'warning';
  return 'ok';
}

const CELL_CONFIG: Record<CellStatus, { icon: ElementType; cls: string; label: string }> = {
  ok:      { icon: CheckCircle2, cls: 'text-green-600 bg-green-50',  label: 'Aligned' },
  warning: { icon: AlertTriangle,cls: 'text-amber-600 bg-amber-50',  label: 'Warning' },
  error:   { icon: XCircle,      cls: 'text-red-600 bg-red-50',      label: 'Misaligned' },
  'no-data': { icon: Clock,      cls: 'text-gray-400 bg-gray-50',    label: 'No data' },
};

export function AlignmentMatrix({ briefId, clientId, objectives }: AlignmentMatrixProps) {
  const {
    latestBriefRun,
    findings,
    filters,
    loading,
    triggering,
    fetchLatestRunForBrief,
    setFilters,
    resolveFinding,
    triggerRun,
  } = useReconciliationStore();

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedFindings, setExpandedFindings] = useState(false);

  useEffect(() => {
    if (clientId) fetchLatestRunForBrief(briefId, clientId);
  }, [briefId, clientId, fetchLatestRunForBrief]);

  async function handleTrigger() {
    await triggerRun(clientId, briefId);
    // Poll for completion — wait 3s then refetch
    setTimeout(() => fetchLatestRunForBrief(briefId, clientId), 3000);
  }

  async function handleResolve(findingId: string) {
    setResolvingId(findingId);
    await resolveFinding(findingId);
    setResolvingId(null);
  }

  const openFindings = findings.filter((f: ReconciliationFinding) => f.resolved_at === null);
  const criticalCount = openFindings.filter((f: ReconciliationFinding) => f.severity === 'critical' || f.severity === 'error').length;
  const warningCount = openFindings.filter((f: ReconciliationFinding) => f.severity === 'warning').length;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#1B2A4A]">Live Alignment</h3>
          {latestBriefRun && (
            <p className="text-xs text-[#9CA3AF]">
              Last checked {new Date(latestBriefRun.started_at).toLocaleString()}
              {latestBriefRun.status === 'running' && ' · Running…'}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTrigger}
          disabled={triggering || loading || latestBriefRun?.status === 'running'}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${triggering || latestBriefRun?.status === 'running' ? 'animate-spin' : ''}`} />
          Re-check
        </Button>
      </div>

      {/* Summary chips */}
      {openFindings.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
              <XCircle className="h-3 w-3" />
              {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              <AlertTriangle className="h-3 w-3" />
              {warningCount} warning
            </span>
          )}
        </div>
      )}

      {/* Traffic-light matrix */}
      {objectives.length > 0 && (
        <div className="rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                <th className="px-4 py-2.5 text-left text-[#6B7280] font-medium">Objective</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="px-4 py-2.5 text-center text-[#6B7280] font-medium w-28">
                    {PLATFORM_LABELS[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {objectives.map((obj) => (
                <tr key={obj.id}>
                  <td className="px-4 py-2.5 text-sm text-[#1B2A4A] font-medium">{obj.name}</td>
                  {PLATFORMS.map((p) => {
                    const status = latestBriefRun
                      ? getCellStatus(obj.id, p, findings)
                      : 'no-data';
                    const cfg = CELL_CONFIG[status];
                    const Icon = cfg.icon;
                    return (
                      <td key={p} className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${cfg.cls}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!latestBriefRun && !loading && (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-6 text-center">
          <p className="text-sm text-[#9CA3AF] mb-3">
            No reconciliation data yet. Click Re-check to run alignment analysis.
          </p>
        </div>
      )}

      {/* Findings toggle */}
      {findings.length > 0 && (
        <div>
          <button
            onClick={() => setExpandedFindings((v: boolean) => !v)}
            className="text-sm text-[#1B2A4A] font-medium hover:underline"
          >
            {expandedFindings ? 'Hide' : 'Show'} findings ({openFindings.length} open)
          </button>

          {expandedFindings && (
            <div className="mt-3">
              <FindingsList
                findings={findings}
                filters={filters}
                onFilterChange={setFilters}
                onResolve={handleResolve}
                resolvingId={resolvingId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
