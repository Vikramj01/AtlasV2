import { useState, useEffect } from 'react';
import type * as React from 'react';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ActionToggles } from './ActionToggles';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { useTaxonomyStore } from '@/store/taxonomyStore';
import { ihcApi } from '@/lib/api/ihcApi';
import type { WizardStage } from '@/types/journey';
import type { CaseFormat } from '@/types/taxonomy';

const CONVERSION_ACTIONS = new Set(['generate_lead', 'sign_up', 'purchase']);

// Mirror of the regex logic used in RecommendationCard and the backend namingConvention service.
function matchesCaseFormat(name: string, format: CaseFormat): boolean {
  switch (format) {
    case 'snake_case':  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(name);
    case 'camelCase':   return /^[a-z][a-zA-Z0-9]*$/.test(name);
    case 'kebab-case':  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    case 'PascalCase':  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }
}

interface StageCardProps {
  stage: WizardStage;
  canRemove: boolean;
}

export function StageCard({ stage, canRemove }: StageCardProps) {
  const { removeStage, removeProxyStage, updateStageLabel, updateStageUrl, updateStageProxyValue, stageTiming } = useJourneyWizardStore();
  const convention = useTaxonomyStore((s) => s.convention);

  const isProxy = stageTiming[stage.id]?.is_proxy === true;
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(stage.label);

  // IHC warning: fetch open critical/high findings if this stage has conversion actions
  const hasConversionAction = stage.actions.some((a) => CONVERSION_ACTIONS.has(a));
  const [ihcFindingCount, setIhcFindingCount] = useState<number | null>(null);
  useEffect(() => {
    if (!hasConversionAction) return;
    ihcApi
      .getFindingsSummary()
      .then((s) => setIhcFindingCount(s.critical + s.high))
      .catch(() => { /* non-critical, suppress */ });
  }, [hasConversionAction]);

  // Check if the label looks like a hand-typed event identifier (no spaces)
  // and warn if it violates the org's naming convention.
  const labelConventionWarning: string | null = (() => {
    if (!convention) return null;
    const name = (editingLabel ? labelDraft : stage.label).trim();
    if (!name || name.includes(' ')) return null; // human-readable labels with spaces are fine
    if (!matchesCaseFormat(name, convention.event_case)) {
      return `Event name should be ${convention.event_case}`;
    }
    if (convention.event_prefix && !name.startsWith(convention.event_prefix)) {
      return `Missing prefix "${convention.event_prefix}"`;
    }
    return null;
  })();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  function commitLabel() {
    if (labelDraft.trim()) updateStageLabel(stage.id, labelDraft.trim());
    else setLabelDraft(stage.label);
    setEditingLabel(false);
  }

  return (
    <Card ref={setNodeRef} style={style}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              {...attributes}
              {...listeners}
              className="text-muted-foreground/40 cursor-grab active:cursor-grabbing select-none touch-none"
              aria-label="Drag to reorder"
            >
              ⠿
            </span>

            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-[#EEF1F7] text-[#1B2A4A] text-xs font-semibold flex items-center justify-center">
              {stage.order}
            </span>

            {editingLabel ? (
              <input
                autoFocus
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitLabel();
                  if (e.key === 'Escape') { setLabelDraft(stage.label); setEditingLabel(false); }
                }}
                className="flex-1 min-w-0 rounded border border-[#1B2A4A]/40 px-2 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/40"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabel(true)}
                className="flex-1 min-w-0 text-left text-sm font-medium hover:text-[#1B2A4A] truncate"
                title="Click to rename"
              >
                {stage.label}
              </button>
            )}
            {!editingLabel && labelConventionWarning && (
              <span title={labelConventionWarning} className="flex-shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              </span>
            )}
            {isProxy && (
              <span className="flex-shrink-0 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                Proxy signal
              </span>
            )}
            {hasConversionAction && ihcFindingCount !== null && ihcFindingCount > 0 && (
              <Link
                to="/settings/implementation-health"
                className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 transition-colors"
                title="Implementation issue detected — see Health Checks"
              >
                <ShieldAlert className="h-2.5 w-2.5" />
                Implementation issue
              </Link>
            )}
          </div>

          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                const msg = isProxy
                  ? 'Remove this proxy signal stage?'
                  : 'Remove this stage?';
                if (window.confirm(msg)) {
                  if (isProxy) removeProxyStage(stage.id);
                  else removeStage(stage.id);
                }
              }}
              className="ml-2 h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
              aria-label="Remove stage"
            >
              ×
            </Button>
          )}
        </div>

        {editingLabel && labelConventionWarning && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
            <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
            {labelConventionWarning}
          </p>
        )}

        <div className="mt-3">
          <Input
            type="url"
            value={stage.sampleUrl}
            onChange={(e) => updateStageUrl(stage.id, e.target.value)}
            placeholder="Paste a page URL from your site (optional but recommended)"
            className="text-xs bg-muted/40"
          />
        </div>

        <ActionToggles stageId={stage.id} actions={stage.actions} />

        {stage.actions.some((a) => ['generate_lead', 'sign_up', 'purchase'].includes(a)) && (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">
              Proxy value (£)
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              value={stage.proxyValueGbp ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                updateStageProxyValue(stage.id, raw === '' ? undefined : Number(raw));
              }}
              placeholder="e.g. 150"
              className="h-7 w-28 text-xs bg-muted/40"
              title="Assign an estimated £ value to this stage for Value-Based Bidding. E.g. MQL = £150, SQL = £500."
            />
            <span className="text-[10px] text-muted-foreground">for Value-Based Bidding</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
