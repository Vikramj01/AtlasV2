import { type ElementType } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Info } from 'lucide-react';
import type { ReconciliationRun, ReconciliationFinding } from '@/lib/api/reconciliationApi';

type RunStatus = ReconciliationRun['status'];

const STATUS_CONFIG: Record<RunStatus, { label: string; cls: string; icon: ElementType }> = {
  running:   { label: 'Running',   cls: 'bg-blue-100 text-blue-700',   icon: RefreshCw },
  succeeded: { label: 'Succeeded', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  partial:   { label: 'Partial',   cls: 'bg-amber-100 text-amber-700', icon: AlertTriangle },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700',     icon: XCircle },
};

const SEVERITY_CONFIG: { key: ReconciliationFinding['severity']; label: string; cls: string; icon: ElementType }[] = [
  { key: 'critical', label: 'Critical', cls: 'bg-red-100 text-red-700',     icon: XCircle },
  { key: 'error',    label: 'Error',    cls: 'bg-orange-100 text-orange-700', icon: AlertTriangle },
  { key: 'warning',  label: 'Warning',  cls: 'bg-amber-100 text-amber-700',  icon: AlertTriangle },
  { key: 'info',     label: 'Info',     cls: 'bg-blue-100 text-blue-700',    icon: Info },
];

const RUN_TYPE_LABELS: Record<string, string> = {
  scheduled:       'Scheduled run',
  manual:          'Manual run',
  post_brief_lock: 'Post-lock run',
};

interface Props {
  run: ReconciliationRun;
  findings: ReconciliationFinding[];
}

export function ReconciliationRunSummary({ run, findings }: Props) {
  const statusCfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.failed;
  const StatusIcon = statusCfg.icon;

  const durationMs = run.finished_at
    ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
    : null;
  const durationLabel = durationMs !== null
    ? durationMs < 60000 ? `${Math.round(durationMs / 1000)}s` : `${Math.round(durationMs / 60000)}m`
    : 'In progress';

  const openFindings = findings.filter((f) => f.resolved_at === null);
  const countsBySeverity = openFindings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-[#9CA3AF] font-medium uppercase tracking-wide">
            {RUN_TYPE_LABELS[run.run_type] ?? run.run_type}
          </p>
          <p className="text-sm font-semibold text-[#1B2A4A] mt-0.5">
            {new Date(run.started_at).toLocaleString()}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${statusCfg.cls}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          {statusCfg.label}
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs text-[#6B7280]">
        <span>Duration: <strong className="text-[#1B2A4A]">{durationLabel}</strong></span>
        <span>Platforms: <strong className="text-[#1B2A4A]">{run.platforms_run.join(', ') || '—'}</strong></span>
        <span>Total findings: <strong className="text-[#1B2A4A]">{run.total_findings}</strong></span>
      </div>

      {openFindings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {SEVERITY_CONFIG.map(({ key, label, cls, icon: Icon }) => {
            const count = countsBySeverity[key] ?? 0;
            if (count === 0) return null;
            return (
              <span key={key} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${cls}`}>
                <Icon className="h-3 w-3" />
                {count} {label}
              </span>
            );
          })}
        </div>
      )}

      {run.error_summary && (
        <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{run.error_summary}</p>
      )}
    </div>
  );
}
