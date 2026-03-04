import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionToggles } from './ActionToggles';
import { useJourneyWizardStore } from '@/store/journeyWizardStore';
import type { WizardStage } from '@/types/journey';

interface StageCardProps {
  stage: WizardStage;
  canRemove: boolean;
}

export function StageCard({ stage, canRemove }: StageCardProps) {
  const { removeStage, updateStageLabel, updateStageUrl } = useJourneyWizardStore();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(stage.label);

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
    <div ref={setNodeRef} style={style} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Drag handle */}
          <span
            {...attributes}
            {...listeners}
            className="text-gray-300 cursor-grab active:cursor-grabbing select-none touch-none"
            aria-label="Drag to reorder"
          >
            ⠿
          </span>

          {/* Stage number badge */}
          <span className="flex-shrink-0 h-6 w-6 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold flex items-center justify-center">
            {stage.order}
          </span>

          {/* Editable label */}
          {editingLabel ? (
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setLabelDraft(stage.label); setEditingLabel(false); } }}
              className="flex-1 min-w-0 rounded border border-brand-400 px-2 py-0.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingLabel(true)}
              className="flex-1 min-w-0 text-left text-sm font-medium text-gray-900 hover:text-brand-600 truncate"
              title="Click to rename"
            >
              {stage.label}
            </button>
          )}
        </div>

        {canRemove && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Remove this stage?')) removeStage(stage.id);
            }}
            className="ml-2 text-gray-400 hover:text-red-500 flex-shrink-0"
            aria-label="Remove stage"
          >
            ×
          </button>
        )}
      </div>

      {/* URL input */}
      <div className="mt-3">
        <input
          type="url"
          value={stage.sampleUrl}
          onChange={(e) => updateStageUrl(stage.id, e.target.value)}
          placeholder="Paste a page URL from your site (optional but recommended)"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 placeholder-gray-400 focus:border-brand-400 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Action toggles */}
      <ActionToggles stageId={stage.id} actions={stage.actions} />
    </div>
  );
}
