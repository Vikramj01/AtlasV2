import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ActionToggles } from './ActionToggles';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import { useTaxonomyStore } from '@/store/taxonomyStore';
import type { WizardStage } from '@/types/journey';
import type { CaseFormat } from '@/types/taxonomy';

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
  const { removeStage, updateStageLabel, updateStageUrl } = useJourneyWizardStore();
  const convention = useTaxonomyStore((s) => s.convention);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(stage.label);

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
          </div>

          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.confirm('Remove this stage?')) removeStage(stage.id);
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
      </CardContent>
    </Card>
  );
}
