import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getJourney } from '@/lib/api/journeyApi';
import { auditApi } from '@/lib/api/auditApi';
import type { JourneyWithDetails, StageStatus } from '@/types/journey';
import { ScoreCard } from '@/components/common/ScoreCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { MetricGuidance } from '@/components/shared/MetricGuidance';
import { journeyGapGuidance } from '@/lib/guidance/metricGuidance';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PlanningContext {
  session_id: string;
  website_url: string;
  planned_events: string[];
}

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
  not_checked:     { label: '— Not Checked',     color: 'text-muted-foreground', bg: 'bg-muted', border: 'border' },
};

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', cls: 'bg-red-100 text-red-700 hover:bg-red-100' },
  high:     { label: 'High',     cls: 'bg-orange-100 text-orange-700 hover:bg-orange-100' },
  medium:   { label: 'Medium',   cls: 'bg-amber-100 text-amber-700 hover:bg-amber-100' },
  info:     { label: 'Info',     cls: 'bg-blue-100 text-blue-700 hover:bg-blue-100' },
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
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge className={sev.cls}>{sev.label}</Badge>
            <span className="text-xs text-muted-foreground uppercase tracking-wide">{gap.platform}</span>
          </div>
          <span className="text-xs text-muted-foreground/60">{effortLabel(gap.estimated_effort)} · {gap.fix_owner}</span>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium text-foreground">Expected: </span>
            <span className="text-muted-foreground">{gap.expected}</span>
          </div>
          <div>
            <span className="font-medium text-foreground">Found: </span>
            <span className="text-muted-foreground">{gap.found}</span>
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
            <span className="text-xs font-semibold text-amber-800">Business impact: </span>
            <span className="text-xs text-amber-700">{gap.business_impact}</span>
          </div>
          {gap.fix_code && gap.fix_code.length > 10 && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">Fix:</span>
                <Button variant="ghost" size="sm" onClick={copy} className="h-auto py-0 px-1 text-xs text-[#1B2A4A] hover:text-[#1B2A4A]">
                  {copied ? '✓ Copied' : 'Copy code'}
                </Button>
              </div>
              <pre className="rounded-lg bg-gray-900 text-green-300 text-xs p-3 overflow-x-auto whitespace-pre-wrap">
                {gap.fix_code}
              </pre>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {gaps.length > 0 && (
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-foreground">
              {gaps.length} issue{gaps.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-muted-foreground text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t bg-background p-4 space-y-3">
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
      <div className="space-y-3 mb-6">
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <span className="text-green-600 text-lg">✓</span>
          <span className="text-sm font-semibold text-green-800">All signals healthy</span>
          <span className="text-sm text-green-600 ml-1">— no tracking gaps detected across your funnel</span>
        </div>
        <MetricGuidance result={journeyGapGuidance(0, 0, 0)} />
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">Issues found:</span>
        {critical > 0 && (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">{critical} Critical</Badge>
        )}
        {high > 0 && (
          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">{high} High</Badge>
        )}
        {medium > 0 && (
          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{medium} Medium</Badge>
        )}
        {critical > 0 && (
          <span className="text-xs text-red-700 ml-auto">
            Critical issues mean data is being lost right now
          </span>
        )}
      </div>
      <MetricGuidance result={journeyGapGuidance(critical, high, allGaps.length)} collapsible />
    </div>
  );
}

// ── Next Steps Block ──────────────────────────────────────────────────────────

function NextSteps({
  journeyId,
  allGaps,
  onDownloadPDF,
}: {
  journeyId: string;
  allGaps: Gap[];
  onDownloadPDF: () => void;
}) {
  const criticalGaps = allGaps.filter((g) => g.severity === 'critical');
  const highGaps     = allGaps.filter((g) => g.severity === 'high');
  const isHealthy    = allGaps.length === 0;

  const priorityGaps = [...criticalGaps, ...highGaps];
  const byOwner: Record<string, Gap[]> = {};
  for (const gap of priorityGaps) {
    if (!byOwner[gap.fix_owner]) byOwner[gap.fix_owner] = [];
    byOwner[gap.fix_owner].push(gap);
  }

  return (
    <Card className="mt-10">
      <CardContent className="pt-6">
        <h2 className="text-base font-bold text-foreground mb-1">What to do next</h2>

        {isHealthy ? (
          <div>
            <p className="text-sm text-muted-foreground mb-5">
              Your tracking is firing correctly across all funnel stages. The next step is to hand
              the <strong>Implementation Spec</strong> to your development team — it documents exactly
              what each page needs to fire, and what parameters are required.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Link
                to={`/journey/${journeyId}/spec`}
                className="flex flex-col gap-1 rounded-xl border-2 border-[#1B2A4A] bg-[#EEF1F7] px-4 py-3 hover:bg-[#EEF1F7] transition-colors"
              >
                <span className="text-sm font-semibold text-[#1B2A4A]">View Implementation Spec</span>
                <span className="text-xs text-[#1B2A4A]">
                  Send to your dev team — per-page tracking code and requirements
                </span>
              </Link>
              <button
                onClick={onDownloadPDF}
                className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm font-semibold text-foreground">Download PDF Report</span>
                <span className="text-xs text-muted-foreground">
                  Share the full signal health report with stakeholders
                </span>
              </button>
              <div className="flex flex-col gap-1 rounded-xl border px-4 py-3 opacity-50 cursor-not-allowed">
                <span className="text-sm font-semibold text-foreground">Set Up Monitoring</span>
                <span className="text-xs text-muted-foreground">Coming soon — alerts when signals break</span>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground mb-5">
              {criticalGaps.length > 0
                ? `You have ${criticalGaps.length} critical issue${criticalGaps.length !== 1 ? 's' : ''} causing data loss right now. Fix these first, then re-run the audit.`
                : `You have ${allGaps.length} issues to fix. Use the Implementation Spec to give your developers a reference for the correct tracking setup.`}
            </p>

            {Object.keys(byOwner).length > 0 && (
              <div className="mb-5 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Priority fixes — assign to your team
                </h3>
                {Object.entries(byOwner).map(([owner, gaps]) => (
                  <div key={owner} className="rounded-lg border p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">{owner}</p>
                    <ul className="space-y-1">
                      {gaps.map((g, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <span className={cn('mt-0.5 shrink-0 rounded-full w-1.5 h-1.5', g.severity === 'critical' ? 'bg-destructive' : 'bg-orange-400')} />
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
                className="flex flex-col gap-1 rounded-xl border-2 border-[#1B2A4A] bg-[#EEF1F7] px-4 py-3 hover:bg-[#EEF1F7] transition-colors"
              >
                <span className="text-sm font-semibold text-[#1B2A4A]">View Implementation Spec</span>
                <span className="text-xs text-[#1B2A4A]">
                  The full per-page tracking code your dev team should implement to fix these gaps
                </span>
              </Link>
              <button
                onClick={onDownloadPDF}
                className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm font-semibold text-foreground">Download PDF Report</span>
                <span className="text-xs text-muted-foreground">
                  Share with your team or client — includes all gaps and fix instructions
                </span>
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Planning Context Banner ───────────────────────────────────────────────────

function PlanningContextBanner({
  context,
  allGaps,
}: {
  context: PlanningContext;
  allGaps: Gap[];
}) {
  const [open, setOpen] = useState(false);

  // Check how many planned events appear in gap fixes / action keys
  const detectedEventKeys = new Set(
    allGaps.map((g) => g.action_key.toLowerCase()),
  );
  const gapEventNames = new Set(allGaps.map((g) => g.expected.toLowerCase()));
  const missingEvents = context.planned_events.filter(
    (e) =>
      !detectedEventKeys.has(e.toLowerCase()) && !gapEventNames.has(e.toLowerCase()),
  );
  const issueCount = context.planned_events.length - missingEvents.length;

  return (
    <div className="mb-6 rounded-xl border border-[#1B2A4A]/20 bg-[#EEF1F7] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[#1B2A4A] text-base">◎</span>
          <div>
            <p className="text-sm font-semibold text-[#1B2A4A]">
              Created from Planning Mode
            </p>
            <p className="text-xs text-[#1B2A4A]">
              {context.planned_events.length} events planned for{' '}
              <span className="font-medium">{context.website_url}</span>
              {issueCount > 0 && (
                <span className="ml-1 text-amber-700">
                  · {issueCount} have gaps
                </span>
              )}
            </p>
          </div>
        </div>
        <span className={`text-xs text-[#1B2A4A] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="border-t border-[#EEF1F7] bg-white/60 px-4 py-3">
          <p className="mb-2 text-xs font-medium text-[#1B2A4A]">Planned events</p>
          <div className="flex flex-wrap gap-1.5">
            {context.planned_events.map((event) => {
              const hasGap =
                detectedEventKeys.has(event.toLowerCase()) ||
                gapEventNames.has(event.toLowerCase());
              return (
                <span
                  key={event}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    hasGap
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {hasGap ? '⚠ ' : '✓ '}
                  {event}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Green = no gaps detected · Amber = issues found in this audit
          </p>
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
  const [planningContext, setPlanningContext] = useState<PlanningContext | null>(null);
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
      .then(([journeyDetails, gapsResponse, auditReport]) => {
        setDetails(journeyDetails);
        setGapResults(gapsResponse.results as JourneyAuditResult[]);
        setPlanningContext(gapsResponse.planning_context);
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
        <p className="text-sm text-muted-foreground">Loading gap report…</p>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-destructive">{error ?? 'Report not found'}</p>
        <Link to="/journey/new" className="mt-4 inline-block text-sm text-[#1B2A4A] hover:underline">
          Start a new audit
        </Link>
      </div>
    );
  }

  const { journey, stages } = details;

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
          <h1 className="text-xl font-bold text-foreground">Signal Health Report</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{journey.name} · {stages.length} stages scanned</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/journey/${id}/spec`}>View Tracking Spec</Link>
          </Button>
          <Button size="sm" onClick={downloadPDF} className="bg-[#1B2A4A] hover:bg-[#1B2A4A]">
            Download PDF
          </Button>
        </div>
      </div>

      {/* Planning context banner — shown when audit was created from Planning Mode */}
      {planningContext && (
        <PlanningContextBanner context={planningContext} allGaps={allGaps} />
      )}

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
        <h2 className="text-sm font-semibold text-foreground mb-3">Journey Stage Results</h2>

        {/* Horizontal funnel overview */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-4 rounded-xl bg-muted border">
          {stages.map((stage, i) => {
            const result = stageResultMap[stage.stage_order];
            const status: StageStatus = result?.stage_status ?? 'not_checked';
            const cfg = STATUS_CONFIG[status];
            return (
              <span key={stage.id} className="flex items-center gap-1.5">
                <span className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${cfg.color} ${cfg.bg} ${cfg.border}`}>
                  {stage.label}
                </span>
                {i < stages.length - 1 && <span className="text-muted-foreground/40">→</span>}
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
        allGaps={allGaps}
        onDownloadPDF={downloadPDF}
      />
    </div>
  );
}
