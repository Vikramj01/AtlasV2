import { useNavigate } from 'react-router-dom';
import { CheckCircle, ArrowRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStrategyStore } from '@/store/strategyStore';
import type { EventVerdict } from '@/types/strategy';

const VERDICT_LABELS: Record<EventVerdict, string> = {
  CONFIRM: 'Keep current event',
  AUGMENT: 'Add proxy event',
  REPLACE: 'Switch conversion event',
};

interface BriefLockedProps {
  onNewBrief: () => void;
}

export function BriefLocked({ onNewBrief }: BriefLockedProps) {
  const navigate = useNavigate();
  const { activeBrief } = useStrategyStore();

  const objectives = activeBrief?.objectives ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center text-center pt-4">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="size-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Strategy brief locked</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Your conversion strategy is set. Start a site scan to build a matching tracking plan.
        </p>
      </div>

      {objectives.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Locked objectives
          </p>
          {objectives.map((obj) => (
            <div
              key={obj.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
            >
              <p className="text-sm font-medium">{obj.name}</p>
              {obj.verdict && (
                <span className="text-xs text-muted-foreground">{VERDICT_LABELS[obj.verdict]}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button onClick={() => navigate('/planning')} className="w-full">
          Start site scan
          <ArrowRight className="ml-2 size-4" />
        </Button>
        <Button variant="outline" onClick={onNewBrief} className="w-full">
          <Plus className="mr-2 size-4" />
          Create a new brief
        </Button>
      </div>
    </div>
  );
}
