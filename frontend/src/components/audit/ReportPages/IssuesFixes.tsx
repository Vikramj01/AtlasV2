import { useState } from 'react';
import type { ReportJSON, ReportIssue, Severity } from '@/types/audit';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { EFFORT_LABELS } from '@/utils/languageMap';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

function IssueCard({ issue }: { issue: ReportIssue }) {
  const [open, setOpen] = useState(issue.severity === 'critical' || issue.severity === 'high');

  return (
    <div className={`rounded-xl border bg-white overflow-hidden ${
      issue.severity === 'critical' ? 'border-red-200' :
      issue.severity === 'high'     ? 'border-orange-200' :
      issue.severity === 'medium'   ? 'border-yellow-200' :
                                      'border-gray-200'
    }`}>
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug">{issue.problem}</p>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={issue.severity} size="sm" />
            <span className="text-xs text-gray-400">{issue.recommended_owner}</span>
          </div>
        </div>
        <span className="shrink-0 text-gray-400 text-sm mt-0.5" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Why this matters</p>
            <p className="mt-1.5 text-sm text-gray-700 leading-relaxed">{issue.why_it_matters}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-400">Who fixes it</p>
              <p className="mt-0.5 text-sm font-medium text-gray-900">{issue.recommended_owner}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-400">Estimated effort</p>
              <p className="mt-0.5 text-sm font-medium text-gray-900">{EFFORT_LABELS[issue.estimated_effort]}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-gray-400">Rule ID</p>
              <p className="mt-0.5 font-mono text-xs text-gray-600">{issue.rule_id}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">How to fix it</p>
            <p className="mt-1.5 text-sm text-gray-700 leading-relaxed">{issue.fix_summary}</p>
          </div>
        </div>
      )}
    </div>
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
        <h2 className="text-lg font-semibold text-gray-900">Issues & Fixes</h2>
        <p className="mt-1 text-sm text-gray-500">
          {sorted.length} issue{sorted.length !== 1 ? 's' : ''} found, sorted by priority.
        </p>
      </div>

      {/* Critical pinned at top */}
      {critical.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-red-600">
            ⚠ Critical — Fix immediately
          </p>
          {critical.map((issue) => <IssueCard key={issue.rule_id} issue={issue} />)}
        </div>
      )}

      {/* Remaining issues */}
      {rest.length > 0 && (
        <div className="space-y-3">
          {critical.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Other issues
            </p>
          )}
          {rest.map((issue) => <IssueCard key={issue.rule_id} issue={issue} />)}
        </div>
      )}
    </div>
  );
}
