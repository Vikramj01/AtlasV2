import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';
import type { PlanningRecommendation, UserDecision } from '@/types/planning';

interface RecommendationCardProps {
  rec: PlanningRecommendation;
  index: number;
  sessionId: string;
  isSelected: boolean;
  onSelect: () => void;
  /** Map of signal key → pack name for signals already deployed to the linked client */
  packCoverage?: Map<string, string>;
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
  high:   'bg-green-100 text-green-700 hover:bg-green-100',
  medium: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
  low:    'bg-gray-100 text-gray-500 hover:bg-gray-100',
};

const DECISION_STYLES: Record<UserDecision, string> = {
  approved: 'border-green-300 bg-green-50',
  skipped:  'border-border bg-muted/40 opacity-60',
  edited:   'border-brand-300 bg-brand-50',
};

export function RecommendationCard({ rec, index, sessionId, isSelected, onSelect, packCoverage }: RecommendationCardProps) {
  const updateRecommendation = usePlanningStore((s) => s.updateRecommendation);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedEventName, setEditedEventName] = useState(rec.event_name);

  const tier = confidenceTier(rec.confidence_score);
  const coveredByPack = packCoverage?.get(rec.event_name);

  async function decide(decision: UserDecision, eventName?: string) {
    setIsSaving(true);
    try {
      const config = eventName && eventName !== rec.event_name ? { event_name: eventName } : undefined;
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

  const cardBorder = rec.user_decision
    ? DECISION_STYLES[rec.user_decision]
    : isSelected
    ? 'border-brand-400 bg-background'
    : 'border-border bg-background hover:border-border/60';

  return (
    <div
      className={cn('cursor-pointer rounded-lg border p-3.5 transition-all', cardBorder)}
      onClick={onSelect}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{rec.event_name}</p>
          <p className="text-xs text-muted-foreground">
            {rec.action_type.replace(/_/g, ' ')}
            {rec.element_text ? ` · "${rec.element_text}"` : ''}
          </p>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <Badge
            className={cn(CONFIDENCE_COLORS[tier])}
            title={`Confidence: ${Math.round(rec.confidence_score * 100)}%`}
          >
            {CONFIDENCE_LABEL[tier]}
          </Badge>
          {coveredByPack && (
            <Badge
              className="bg-indigo-50 text-indigo-700 hover:bg-indigo-50 whitespace-nowrap"
              title={`This signal is already included in the "${coveredByPack}" pack deployed to this client`}
            >
              📦 In {coveredByPack}
            </Badge>
          )}
        </div>
      </div>

      {coveredByPack && (
        <p className="mb-2 rounded-md border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-700">
          This event is already covered by the <strong>{coveredByPack}</strong> pack deployed to this client.
          You can still approve it to customise parameters, or skip it.
        </p>
      )}

      <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{rec.business_justification}</p>

      {rec.element_selector && (
        <p className="mb-3 truncate rounded bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {rec.element_selector}
        </p>
      )}

      {isEditing && (
        <div className="mb-3" onClick={(e) => e.stopPropagation()}>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Custom event name
          </label>
          <Input
            type="text"
            value={editedEventName}
            onChange={(e) => setEditedEventName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => decide('edited', editedEventName)}
              disabled={isSaving || !editedEventName.trim()}
              className="h-7 text-xs bg-brand-600 hover:bg-brand-700"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setIsEditing(false); setEditedEventName(rec.event_name); }}
              className="h-7 text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {rec.user_decision ? (
          <span className="text-xs text-muted-foreground">
            {rec.user_decision === 'approved' && '✓ Approved'}
            {rec.user_decision === 'skipped'  && '— Skipped'}
            {rec.user_decision === 'edited'   && '✎ Customised'}
            {' · '}
            <button onClick={() => decide('approved')} className="text-brand-600 hover:underline">
              change
            </button>
          </span>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => decide('approved')}
              disabled={isSaving}
              className="h-7 border-green-300 bg-green-50 text-green-700 hover:bg-green-100 text-xs"
              variant="outline"
            >
              ✓ Approve
            </Button>
            <Button
              size="sm"
              onClick={() => { setIsEditing(true); onSelect(); }}
              disabled={isSaving}
              className="h-7 border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 text-xs"
              variant="outline"
            >
              ✎ Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => decide('skipped')}
              disabled={isSaving}
              className="h-7 text-muted-foreground text-xs"
            >
              — Skip
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
