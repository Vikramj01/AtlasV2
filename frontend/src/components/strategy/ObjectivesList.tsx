import { useState } from 'react';
import { Plus, Lock, Check, AlertTriangle, X, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useStrategyStore } from '@/store/strategyStore';
import type { StrategyObjective, EventVerdict } from '@/types/strategy';

const VERDICT_BADGE: Record<
  EventVerdict,
  { label: string; badgeClass: string; icon: React.ElementType }
> = {
  CONFIRM: { label: 'Keep', badgeClass: 'bg-green-100 text-green-800', icon: Check },
  AUGMENT: { label: 'Add proxy', badgeClass: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle },
  REPLACE: { label: 'Switch', badgeClass: 'bg-red-100 text-red-800', icon: X },
};

interface ObjectivesListProps {
  briefId: string;
  onAddObjective: () => void;
  onSelectObjective: (id: string) => void;
  onBriefLocked: () => void;
}

export function ObjectivesList({
  briefId,
  onAddObjective,
  onSelectObjective,
  onBriefLocked,
}: ObjectivesListProps) {
  const { activeBrief, lockBrief } = useStrategyStore();
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const objectives = activeBrief?.objectives ?? [];
  const allLocked = objectives.length > 0 && objectives.every((o) => o.locked);

  async function handleLockBrief() {
    setLocking(true);
    setError(null);
    try {
      await lockBrief(briefId);
      onBriefLocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your objectives</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Lock all objectives to finalise your strategy brief.
        </p>
      </div>

      <div className="space-y-3">
        {objectives.map((obj) => (
          <ObjectiveRow
            key={obj.id}
            objective={obj}
            onSelect={() => onSelectObjective(obj.id)}
          />
        ))}
      </div>

      {!allLocked && (
        <Button variant="outline" onClick={onAddObjective} className="w-full">
          <Plus className="mr-2 size-4" />
          Add another objective
        </Button>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Button onClick={handleLockBrief} disabled={!allLocked || locking} className="w-full">
          {locking ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Locking brief…
            </>
          ) : (
            <>
              <Lock className="mr-2 size-4" />
              Lock strategy brief
            </>
          )}
        </Button>
        {!allLocked && (
          <p className="text-center text-xs text-muted-foreground">
            Lock all objectives to enable this button.
          </p>
        )}
      </div>
    </div>
  );
}

function ObjectiveRow({
  objective,
  onSelect,
}: {
  objective: StrategyObjective;
  onSelect: () => void;
}) {
  const badge = objective.verdict ? VERDICT_BADGE[objective.verdict] : null;
  const BadgeIcon = badge?.icon;

  return (
    <button
      type="button"
      onClick={objective.locked ? undefined : onSelect}
      disabled={objective.locked}
      className={cn(
        'w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors',
        objective.locked
          ? 'bg-muted/40 border-border cursor-default'
          : 'hover:bg-muted/50 hover:border-primary/30 cursor-pointer',
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            objective.locked ? 'bg-green-100' : 'bg-muted',
          )}
        >
          {objective.locked ? (
            <Lock className="size-4 text-green-700" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium">{objective.name}</p>
          {badge && BadgeIcon && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium mt-0.5',
                badge.badgeClass,
              )}
            >
              <BadgeIcon className="size-3" />
              {badge.label}
            </span>
          )}
        </div>
      </div>
      {objective.locked && (
        <span className="text-xs font-medium text-green-700">Locked</span>
      )}
    </button>
  );
}
