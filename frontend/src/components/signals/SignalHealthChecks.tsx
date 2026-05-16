import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Loader2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ihcApi } from '@/lib/api/ihcApi';
import type { AuditFinding, FindingSeverity } from '@/types/ihc';
import { PlanGate } from '@/components/common/PlanGate';

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};

const SEVERITY_DOT: Record<FindingSeverity, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-gray-300',
};

const STATUS_LABEL: Record<string, string> = {
  open:         'Open',
  acknowledged: 'Acknowledged',
  resolved:     'Resolved',
  suppressed:   'Suppressed',
};

function FindingRow({ finding }: { finding: AuditFinding }) {
  const [expanded, setExpanded] = useState(false);
  const evidenceEntries = Object.entries(finding.evidence ?? {}).slice(0, 4);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`}
          aria-label={SEVERITY_LABEL[finding.severity]}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold font-mono text-foreground truncate">{finding.rule_id}</p>
          <div className="mt-0.5 flex flex-wrap gap-2">
            <span className="text-[10px] text-muted-foreground">{SEVERITY_LABEL[finding.severity]}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{STATUS_LABEL[finding.status] ?? finding.status}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">
              Detected {new Date(finding.first_detected_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground mt-1">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && evidenceEntries.length > 0 && (
        <div className="px-4 pb-3 ml-5">
          <div className="rounded-md bg-muted p-2.5 space-y-1">
            {evidenceEntries.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-[10px]">
                <span className="font-semibold text-muted-foreground min-w-[80px] shrink-0">{k}</span>
                <span className="font-mono text-foreground break-all">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  eventName: string;
}

export function SignalHealthChecks({ eventName }: Props) {
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    ihcApi
      .getFindings()
      .then((all) => {
        // Filter findings whose evidence references this event name
        const relevant = all.filter((f) => {
          const ev = f.evidence as Record<string, unknown>;
          return (
            ev['event_name'] === eventName ||
            ev['tag_name']?.toString().toLowerCase().includes(eventName.toLowerCase()) ||
            JSON.stringify(ev).toLowerCase().includes(eventName.toLowerCase())
          );
        });
        setFindings(relevant);
      })
      .catch(() => setError('Unable to load health checks'))
      .finally(() => setLoading(false));
  }, [eventName]);

  return (
    <PlanGate minPlan="pro" featureName="Implementation Health Checks">
      <div className="mt-3 border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Health Checks
          </p>
          <Link
            to="/settings/implementation-health"
            className="flex items-center gap-1 text-[10px] text-[#1B2A4A] hover:underline"
          >
            View all <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>

        {loading && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking…
          </div>
        )}

        {error && (
          <p className="text-[10px] text-destructive">{error}</p>
        )}

        {!loading && !error && findings.length === 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-green-500 shrink-0" />
            No open findings for this signal.
          </div>
        )}

        {!loading && !error && findings.length > 0 && (
          <div className="rounded-md border border-border overflow-hidden">
            <div className="flex items-center gap-1.5 bg-amber-50 border-b border-amber-200 px-3 py-2">
              <ShieldAlert className="h-3 w-3 text-amber-600 shrink-0" />
              <p className="text-[10px] font-medium text-amber-800">
                {findings.filter((f) => f.status === 'open').length} open finding
                {findings.filter((f) => f.status === 'open').length !== 1 ? 's' : ''}
              </p>
            </div>
            {findings.slice(0, 5).map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </div>
        )}
      </div>
    </PlanGate>
  );
}
