import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import type { ReportJSON, ReportIssue, Severity } from '@/types/audit';
import { EFFORT_LABELS } from '@/utils/languageMap';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

const BORDER_BY_SEVERITY: Record<Severity, string> = {
  critical: 'border-red-200',
  high:     'border-orange-200',
  medium:   'border-yellow-200',
  low:      'border-border',
};

function IssueCard({ issue }: { issue: ReportIssue }) {
  const [open, setOpen] = useState(issue.severity === 'critical' || issue.severity === 'high');

  return (
    <Card className={cn('overflow-hidden', BORDER_BY_SEVERITY[issue.severity])}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className="text-sm font-semibold leading-snug">{issue.problem}</p>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} size="sm" />
            <span className="text-xs text-muted-foreground">{issue.recommended_owner}</span>
          </div>
        </div>
        <span className="shrink-0 text-muted-foreground text-sm mt-0.5" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <>
          <Separator />
          <CardContent className="px-5 py-4 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this matters</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{issue.why_it_matters}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">Who fixes it</p>
                <p className="mt-0.5 text-sm font-medium">{issue.recommended_owner}</p>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">Estimated effort</p>
                <p className="mt-0.5 text-sm font-medium">{EFFORT_LABELS[issue.estimated_effort]}</p>
              </div>
              <div className="rounded-lg bg-muted px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">Rule ID</p>
                <p className="mt-0.5 font-mono text-xs">{issue.rule_id}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How to fix it</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{issue.fix_summary}</p>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}

interface Props {
  report: ReportJSON;
}

export function IssuesFixes({ report }: Props) {
  const sorted = [...report.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  const critical = sorted.filter((i) => i.severity === 'critical');
  const rest = sorted.filter((i) => i.severity !== 'critical');

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
        <p className="font-semibold text-green-800">No issues found.</p>
        <p className="mt-1 text-sm text-green-700">All signals are functioning correctly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" id="issues">
      <div>
        <h2 className="text-lg font-semibold">Issues & Fixes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {sorted.length} issue{sorted.length !== 1 ? 's' : ''} found, sorted by priority.
        </p>
      </div>

      {critical.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-red-600">
            ⚠ Critical — Fix immediately
          </p>
          {critical.map((issue) => <IssueCard key={issue.rule_id} issue={issue} />)}
        </div>
      )}

      {rest.length > 0 && (
        <div className="space-y-3">
          {critical.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Other issues
            </p>
          )}
          {rest.map((issue) => <IssueCard key={issue.rule_id} issue={issue} />)}
        </div>
      )}
    </div>
  );
}
