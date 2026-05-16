import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SeverityBadge } from '@/components/common/SeverityBadge';
import { InfoTooltip } from '@/components/common/InfoTooltip';
import { TOOLTIPS } from '@/lib/ui-copy';
import type { ReportJSON, ReportIssue, Severity, ValidationLayerFilter } from '@/types/audit';
import { EFFORT_LABELS } from '@/utils/languageMap';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

const BORDER_BY_SEVERITY: Record<Severity, string> = {
  critical: 'border-red-200',
  high:     'border-orange-200',
  medium:   'border-yellow-200',
  low:      'border-border',
};

// ── Layer filter chip config ───────────────────────────────────────────────────

const LAYER_CHIPS: { value: ValidationLayerFilter; label: string }[] = [
  { value: 'signal_initiation',      label: 'Signal Initiation' },
  { value: 'parameter_completeness', label: 'Parameter Completeness' },
  { value: 'persistence',            label: 'Persistence' },
  { value: 'tag_configuration',      label: 'Tag Configuration' },
  { value: 'implementation_drift',   label: 'Drift Detection' },
];

function LayerFilterChips({
  active,
  onChange,
  availableLayers,
}: {
  active: Set<ValidationLayerFilter>;
  onChange: (next: Set<ValidationLayerFilter>) => void;
  availableLayers: Set<ValidationLayerFilter>;
}) {
  const visible = LAYER_CHIPS.filter((c) => availableLayers.has(c.value));
  if (visible.length < 2) return null;

  function toggle(layer: ValidationLayerFilter) {
    const next = new Set(active);
    if (next.has(layer)) {
      if (next.size === 1) return; // always keep at least one selected
      next.delete(layer);
    } else {
      next.add(layer);
    }
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map(({ value, label }) => {
        const on = active.has(value);
        return (
          <button
            key={value}
            type="button"
            onClick={() => toggle(value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              on
                ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
                : 'border-border bg-background text-muted-foreground hover:border-[#1B2A4A]/40',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Layer badge on each issue card ────────────────────────────────────────────

const LAYER_BADGE: Partial<Record<ValidationLayerFilter, { label: string; className: string }>> = {
  tag_configuration:    { label: 'GTM Config', className: 'bg-purple-100 text-purple-700' },
  implementation_drift: { label: 'Drift',      className: 'bg-amber-100 text-amber-700' },
};

function IssueCard({ issue }: { issue: ReportIssue }) {
  const [open, setOpen] = useState(issue.severity === 'critical' || issue.severity === 'high');
  const layerBadge = issue.validation_layer ? LAYER_BADGE[issue.validation_layer] : undefined;

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
            {layerBadge && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', layerBadge.className)}>
                {layerBadge.label}
              </span>
            )}
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
  const all = [...report.issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  const availableLayers = new Set(
    all.map((i) => i.validation_layer).filter(Boolean) as ValidationLayerFilter[],
  );

  const [activeLayers, setActiveLayers] = useState<Set<ValidationLayerFilter>>(
    () => new Set(LAYER_CHIPS.map((c) => c.value)),
  );

  const sorted = all.filter(
    (i) => !i.validation_layer || activeLayers.has(i.validation_layer),
  );

  const critical = sorted.filter((i) => i.severity === 'critical');
  const rest = sorted.filter((i) => i.severity !== 'critical');

  if (all.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
        <p className="font-semibold text-green-800">No issues found.</p>
        <p className="mt-1 text-sm text-green-700">All signals are functioning correctly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5" id="issues">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-semibold">Issues & Fixes</h2>
            <InfoTooltip entry={TOOLTIPS.gapClassification} side="right" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {sorted.length} of {all.length} issue{all.length !== 1 ? 's' : ''} shown.
          </p>
        </div>

        <LayerFilterChips
          active={activeLayers}
          onChange={setActiveLayers}
          availableLayers={availableLayers}
        />
      </div>

      {sorted.length === 0 && (
        <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          No issues match the selected filters.
        </div>
      )}

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
