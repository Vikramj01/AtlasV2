import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJourney } from '@/lib/api/journeyApi';
import { auditApi } from '@/lib/api/auditApi';
import type { JourneyWithDetails, StageStatus } from '@/types/journey';
import { ScoreCard } from '@/components/common/ScoreCard';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Gap {
  gap_type: 'MISSING' | 'WRONG' | 'EXTRA';
  sub_type: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  action_key: string;
  platform: string;
  expected: string;
  found: string;
  business_impact: string;
  fix_owner: string;
  fix_description: string;
  fix_code: string;
  estimated_effort: string;
}

interface JourneyAuditResult {
  id: string;
  stage_id: string;
  stage_status: StageStatus;
  gaps: Gap[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<StageStatus, { label: string; color: string; bg: string; border: string }> = {
  healthy:         { label: '✓ Healthy',         color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-300' },
  issues_found:    { label: '⚠ Issues Found',    color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-300' },
  signals_missing: { label: '✗ Signals Missing', color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-300' },
  not_checked:     { label: '— Not Checked',     color: 'text-gray-500',   bg: 'bg-gray-50',   border: 'border-gray-200' },
};

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', cls: 'bg-red-100 text-red-700' },
  high:     { label: 'High',     cls: 'bg-orange-100 text-orange-700' },
  medium:   { label: 'Medium',   cls: 'bg-amber-100 text-amber-700' },
  info:     { label: 'Info',     cls: 'bg-blue-100 text-blue-700' },
};

function effortLabel(effort: string) {
  if (effort === 'low') return '~15 min';
  if (effort === 'medium') return '~1 hour';
  return '~half day';
}

// ── Gap Card ──────────────────────────────────────────────────────────────────

function GapCard({ gap }: { gap: Gap }) {
  const [copied, setCopied] = useState(false);
  const sev = SEVERITY_CONFIG[gap.severity] ?? SEVERITY_CONFIG.info;

  function copy() {
    navigator.clipboard.writeText(gap.fix_code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sev.cls}`}>
            {sev.label}
          </span>
          <span className="text-xs text-gray-500 uppercase tracking-wide">{gap.platform}</span>
        </div>
        <span className="text-xs text-gray-400">{effortLabel(gap.estimated_effort)} · {gap.fix_owner}</span>
      </div>

      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium text-gray-700">Expected: </span>
          <span className="text-gray-600">{gap.expected}</span>
        </div>
        <div>
          <span className="font-medium text-gray-700">Found: </span>
          <span className="text-gray-600">{gap.found}</span>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
          <span className="text-xs font-semibold text-amber-800">Business impact: </span>
          <span className="text-xs text-amber-700">{gap.business_impact}</span>
        </div>
        {gap.fix_code && gap.fix_code.length > 10 && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">Fix:</span>
              <button onClick={copy} className="text-xs text-brand-600 hover:text-brand-700">
                {copied ? '✓ Copied' : 'Copy code'}
              </button>
            </div>
            <pre className="rounded-lg bg-gray-900 text-green-300 text-xs p-3 overflow-x-auto whitespace-pre-wrap">
              {gap.fix_code}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stage Detail Panel ────────────────────────────────────────────────────────

function StageDetailPanel({ label, status, gaps }: { label: string; status: StageStatus; gaps: Gap[] }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[status];

  return (
    <div className={`rounded-xl border-2 ${cfg.border} ${cfg.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
          <span className="text-sm font-medium text-gray-800">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {gaps.length > 0 && (
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-gray-700">
              {gaps.length} issue{gaps.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200 bg-white p-4 space-y-3">
          {gaps.length === 0 ? (
            <p className="text-sm text-green-700">
              {status === 'not_checked'
                ? 'This stage was skipped — no URL was provided.'
                : 'All expected signals are firing correctly on this page.'}
            </p>
          ) : (
            gaps.map((gap, i) => <GapCard key={i} gap={gap} />)
          )}
        </div>
      )}
    </div>
  );
}

// ── Results Summary Bar ───────────────────────────────────────────────────────

function ResultsSummaryBar({ allGaps }: { allGaps: Gap[] }) {
  const critical = allGaps.filter((g) => g.severity === 'critical').length;
  const high     = allGaps.filter((g) => g.severity === 'high').length;
  const medium   = allGaps.filter((g) => g.severity === 'medium').length;

  if (allGaps.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 mb-6">
        <span className="text-green-600 text-lg">✓</span>
        <span className="text-sm font-semibold text-green-800">All signals healthy</span>
        <span className="text-sm text-green-600 ml-1">— no tracking gaps detected across your funnel</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-6">
      <span className="text-sm font-semibold text-gray-800">Issues found:</span>
      {critical > 0 && (
        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
          {critical} Critical
        </span>
      )}
      {high > 0 && (
        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
          {high} High
        </span>
      )}
      {medium > 0 && (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
          {medium} Medium
        </span>
      )}
      {critical > 0 && (
        <span className="text-xs text-red-700 ml-auto">
          Critical issues mean data is being lost right now
        </span>
      )}
    </div>
  );
}

// ── Next Steps Block ──────────────────────────────────────────────────────────

function NextSteps({
  journeyId,
  auditId,
  allGaps,
  onDownloadPDF,
}: {
  journeyId: string;
  auditId: string;
  allGaps: Gap[];
  onDownloadPDF: () => void;
}) {
  const criticalGaps = allGaps.filter((g) => g.severity === 'critical');
  const highGaps     = allGaps.filter((g) => g.severity === 'high');
  const isHealthy    = allGaps.length === 0;

  // Group priority issues by fix owner
  const priorityGaps = [...criticalGaps, ...highGaps];
  const byOwner: Record<string, Gap[]> = {};
  for (const gap of priorityGaps) {
    if (!byOwner[gap.fix_owner]) byOwner[gap.fix_owner] = [];
    byOwner[gap.fix_owner].push(gap);
  }

  return (
    <div className="mt-10 rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="text-base font-bold text-gray-900 mb-1">What to do next</h2>

      {isHealthy ? (
        <div>
          <p className="text-sm text-gray-600 mb-5">
            Your tracking is firing correctly across all funnel stages. The next step is to hand
            the <strong>Implementation Spec</strong> to your development team — it documents exactly
            what each page needs to fire, and what parameters are required.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link
              to={`/journey/${journeyId}/spec`}
              className="flex flex-col gap-1 rounded-xl border-2 border-brand-500 bg-brand-50 px-4 py-3 hover:bg-brand-100 transition-colors"
            >
              <span className="text-sm font-semibold text-brand-700">View Implementation Spec</span>
              <span className="text-xs text-brand-600">
                Send to your dev team — per-page tracking code and requirements
              </span>
            </Link>
            <button
              onClick={onDownloadPDF}
              className="flex flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-700">Download PDF Report</span>
              <span className="text-xs text-gray-500">
                Share the full signal health report with stakeholders
              </span>
            </button>
            <div className="flex flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 opacity-50 cursor-not-allowed">
              <span className="text-sm font-semibold text-gray-700">Set Up Monitoring</span>
              <span className="text-xs text-gray-400">Coming soon — alerts when signals break</span>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-5">
            {criticalGaps.length > 0
              ? `You have ${criticalGaps.length} critical issue${criticalGaps.length !== 1 ? 's' : ''} causing data loss right now. Fix these first, then re-run the audit.`
              : `You have ${allGaps.length} issues to fix. Use the Implementation Spec to give your developers a reference for the correct tracking setup.`}
          </p>

          {/* Priority fix list grouped by owner */}
          {Object.keys(byOwner).length > 0 && (
            <div className="mb-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Priority fixes — assign to your team
              </h3>
              {Object.entries(byOwner).map(([owner, gaps]) => (
                <div key={owner} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-700 mb-2">{owner}</p>
                  <ul className="space-y-1">
                    {gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className={`mt-0.5 shrink-0 rounded-full w-1.5 h-1.5 ${g.severity === 'critical' ? 'bg-red-500' : 'bg-orange-400'}`} />
                        <span>{g.fix_description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to={`/journey/${journeyId}/spec`}
              className="flex flex-col gap-1 rounded-xl border-2 border-brand-500 bg-brand-50 px-4 py-3 hover:bg-brand-100 transition-colors"
            >
              <span className="text-sm font-semibold text-brand-700">View Implementation Spec</span>
              <span className="text-xs text-brand-600">
                The full per-page tracking code your dev team should implement to fix these gaps
              </span>
            </Link>
            <button
              onClick={onDownloadPDF}
              className="flex flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-semibold text-gray-700">Download PDF Report</span>
              <span className="text-xs text-gray-500">
                Share with your team or client — includes all gaps and fix instructions
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function GapReportPage() {
  const { id, auditId } = useParams<{ id: string; auditId: string }>();

  const [details, setDetails] = useState<JourneyWithDetails | null>(null);
  const [gapResults, setGapResults] = useState<JourneyAuditResult[]>([]);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !auditId) return;
    setLoading(true);

    Promise.all([
      getJourney(id),
      auditApi.getGaps(auditId),
      auditApi.getReport(auditId).catch(() => null),
    ])
      .then(([journeyDetails, gaps, auditReport]) => {
        setDetails(journeyDetails);
        setGapResults(gaps as JourneyAuditResult[]);
        setReport(auditReport);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, auditId]);

  function downloadPDF() {
    if (!auditId) return;
    auditApi.export(auditId, 'pdf').then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-report-${auditId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading gap report…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-red-600">{error ?? 'Report not found'}</p>
        <Link to="/journey/new" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Start a new audit
        </Link>
      </div>
    );
  }

  const { journey, stages } = details;

  // Build stage → gap result lookup by matching stage order
  const stageResultMap: Record<number, JourneyAuditResult> = {};
  for (const result of gapResults) {
    const stage = stages.find((s) => s.id === result.stage_id);
    if (stage) stageResultMap[stage.stage_order] = result;
  }

  const allGaps = gapResults.flatMap((r) => r.gaps);
  const scores  = report?.scores;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Signal Health Report</h1>
          <p className="mt-0.5 text-sm text-gray-500">{journey.name} · {stages.length} stages scanned</p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/journey/${id}/spec`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            View Tracking Spec
          </Link>
          <button
            onClick={downloadPDF}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Results summary bar */}
      <ResultsSummaryBar allGaps={allGaps} />

      {/* Score cards */}
      {scores && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
          <ScoreCard
            title="Signal Health"
            value={`${scores.conversion_signal_health ?? 0}/100`}
            description="Rules passing for selected platforms"
            valueColor={(scores.conversion_signal_health ?? 0) >= 80 ? 'green' : (scores.conversion_signal_health ?? 0) >= 50 ? 'yellow' : 'red'}
          />
          <ScoreCard
            title="Attribution Risk"
            value={scores.attribution_risk_level ?? '—'}
            description="Click ID + conversion coverage"
            valueColor={scores.attribution_risk_level === 'Critical' || scores.attribution_risk_level === 'High' ? 'red' : 'green'}
          />
          <ScoreCard
            title="Optimization"
            value={scores.optimization_strength ?? '—'}
            description="User data completeness"
          />
          <ScoreCard
            title="Data Consistency"
            value={scores.data_consistency_score ?? '—'}
            description="Event deduplication accuracy"
          />
        </div>
      )}

      {/* Funnel stage results */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Journey Stage Results</h2>

        {/* Horizontal funnel overview */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-4 rounded-xl bg-gray-50 border border-gray-200">
          {stages.map((stage, i) => {
            const result = stageResultMap[stage.stage_order];
            const status: StageStatus = result?.stage_status ?? 'not_checked';
            const cfg = STATUS_CONFIG[status];
            return (
              <span key={stage.id} className="flex items-center gap-1.5">
                <span className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                  {stage.label}
                </span>
                {i < stages.length - 1 && <span className="text-gray-300">→</span>}
              </span>
            );
          })}
        </div>

        {/* Per-stage detail panels */}
        <div className="space-y-3">
          {stages.map((stage) => {
            const result = stageResultMap[stage.stage_order];
            const status: StageStatus = result?.stage_status ?? 'not_checked';
            return (
              <StageDetailPanel
                key={stage.id}
                label={stage.label}
                status={status}
                gaps={result?.gaps ?? []}
              />
            );
          })}
        </div>
      </div>

      {/* Next steps */}
      <NextSteps
        journeyId={id!}
        auditId={auditId!}
        allGaps={allGaps}
        onDownloadPDF={downloadPDF}
      />
    </div>
  );
}
