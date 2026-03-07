import { useState } from 'react';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';
import type { PlanningRecommendation, UserDecision } from '@/types/planning';

interface RecommendationCardProps {
  rec: PlanningRecommendation;
  index: number;
  sessionId: string;
  isSelected: boolean;
  onSelect: () => void;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high:   'High confidence',
  medium: 'Medium confidence',
  low:    'Low confidence',
};

function confidenceTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

const CONFIDENCE_COLORS = {
  high:   'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-gray-100 text-gray-500',
};

const DECISION_STYLES: Record<UserDecision, string> = {
  approved: 'border-green-300 bg-green-50',
  skipped:  'border-gray-200 bg-gray-50 opacity-60',
  edited:   'border-brand-300 bg-brand-50',
};

// ── Component ──────────────────────────────────────────────────────────────────

export function RecommendationCard({
  rec,
  index,
  sessionId,
  isSelected,
  onSelect,
}: RecommendationCardProps) {
  const updateRecommendation = usePlanningStore((s) => s.updateRecommendation);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedEventName, setEditedEventName] = useState(rec.event_name);

  const tier = confidenceTier(rec.confidence_score);

  async function decide(decision: UserDecision, eventName?: string) {
    setIsSaving(true);
    try {
      const config = eventName && eventName !== rec.event_name
        ? { event_name: eventName }
        : undefined;
      await planningApi.updateDecision(sessionId, rec.id, decision, config);
      updateRecommendation(rec.id, {
        user_decision: decision,
        modified_config: config ?? null,
        decided_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to record decision:', err);
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  }

  async function handleSaveEdit() {
    await decide('edited', editedEventName);
  }

  const cardBorder = rec.user_decision
    ? DECISION_STYLES[rec.user_decision]
    : isSelected
    ? 'border-brand-400 bg-white'
    : 'border-gray-200 bg-white hover:border-gray-300';

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3.5 transition-all ${cardBorder}`}
      onClick={onSelect}
    >
      {/* Header row */}
      <div className="mb-2 flex items-start gap-2">
        {/* Number badge */}
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          {/* Event name */}
          <p className="truncate text-sm font-semibold text-gray-900">{rec.event_name}</p>
          {/* Action type */}
          <p className="text-xs text-gray-500">
            {rec.action_type.replace(/_/g, ' ')}
            {rec.element_text ? ` · "${rec.element_text}"` : ''}
          </p>
        </div>

        {/* Confidence badge */}
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[tier]}`}
          title={`Confidence: ${Math.round(rec.confidence_score * 100)}%`}
        >
          {CONFIDENCE_LABEL[tier]}
        </span>
      </div>

      {/* Business justification */}
      <p className="mb-2 text-xs leading-relaxed text-gray-600">{rec.business_justification}</p>

      {/* Selector */}
      {rec.element_selector && (
        <p className="mb-3 truncate rounded bg-gray-100 px-2 py-1 font-mono text-[10px] text-gray-500">
          {rec.element_selector}
        </p>
      )}

      {/* Inline edit form */}
      {isEditing && (
        <div className="mb-3" onClick={(e) => e.stopPropagation()}>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Custom event name
          </label>
          <input
            type="text"
            value={editedEventName}
            onChange={(e) => setEditedEventName(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editedEventName.trim()}
              className="rounded bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setIsEditing(false); setEditedEventName(rec.event_name); }}
              className="rounded bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Decision buttons */}
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {rec.user_decision ? (
          <span className="text-xs text-gray-400">
            {rec.user_decision === 'approved' && '✓ Approved'}
            {rec.user_decision === 'skipped'  && '— Skipped'}
            {rec.user_decision === 'edited'   && '✎ Customised'}
            {' · '}
            <button
              onClick={() => decide('approved')}
              className="text-brand-600 hover:underline"
            >
              change
            </button>
          </span>
        ) : (
          <>
            <button
              onClick={() => decide('approved')}
              disabled={isSaving}
              className="rounded border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
            >
              ✓ Approve
            </button>
            <button
              onClick={() => { setIsEditing(true); onSelect(); }}
              disabled={isSaving}
              className="rounded border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-50"
            >
              ✎ Edit
            </button>
            <button
              onClick={() => decide('skipped')}
              disabled={isSaving}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            >
              — Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}
