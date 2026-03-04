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
  if (effort === 'low') return 'Low (15 min)';
  if (effort === 'medium') return 'Medium (1 hour)';
  return 'High (half day)';
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
          <span className="text-xs font-mono text-gray-500">
            {gap.gap_type} · {gap.sub_type}
          </span>
        </div>
        <span className="text-xs text-gray-400 uppercase">{gap.platform}</span>
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
          <span className="text-xs font-semibold text-amber-800">Why this matters: </span>
          <span className="text-xs text-amber-700">{gap.business_impact}</span>
        </div>
        <div>
          <span className="text-xs text-gray-500">Fix owner: <strong>{gap.fix_owner}</strong> · Effort: {effortLabel(gap.estimated_effort)}</span>
        </div>
        {gap.fix_code && gap.fix_code.length > 10 && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">How to fix:</span>
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

  // Compute overall health from gap results
  const totalGaps = gapResults.flatMap((r) => r.gaps).length;
  const criticalGaps = gapResults.flatMap((r) => r.gaps).filter((g) => g.severity === 'critical').length;

  const scores = report?.scores;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Your Signal Health Report</h1>
          <p className="mt-1 text-sm text-gray-500">
            {stages.length} stages checked · {totalGaps} issue{totalGaps !== 1 ? 's' : ''} found
            {criticalGaps > 0 && ` (${criticalGaps} critical)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/journey/${id}/spec`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            View Tracking Spec
          </Link>
          <button
            onClick={() => auditApi.export(auditId!, 'pdf').then((blob) => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `atlas-report-${auditId}.pdf`; a.click(); URL.revokeObjectURL(url);
            })}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Score cards */}
      {scores && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
          <ScoreCard title="Signal Health" value={`${scores.conversion_signal_health ?? 0}/100`} description="Passing rules out of 26" valueColor={(scores.conversion_signal_health ?? 0) >= 80 ? 'green' : (scores.conversion_signal_health ?? 0) >= 50 ? 'yellow' : 'red'} />
          <ScoreCard title="Attribution Risk" value={scores.attribution_risk_level ?? '—'} description="Click ID + conversion coverage" valueColor={scores.attribution_risk_level === 'Critical' || scores.attribution_risk_level === 'High' ? 'red' : 'green'} />
          <ScoreCard title="Optimization" value={scores.optimization_strength ?? '—'} description="User data completeness" />
          <ScoreCard title="Data Consistency" value={scores.data_consistency_score ?? '—'} description="Event deduplication accuracy" />
        </div>
      )}

      {/* Funnel visualisation with status badges */}
      <div className="mb-8">
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

      {/* No gaps found */}
      {totalGaps === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-6 py-5 text-center">
          <p className="text-lg font-semibold text-green-800">All signals look healthy!</p>
          <p className="mt-1 text-sm text-green-700">
            No gaps were detected across your funnel. Your tracking setup is working correctly.
          </p>
        </div>
      )}
    </div>
  );
}
