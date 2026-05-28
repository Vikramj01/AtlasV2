import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DashboardDelta } from '@/types/dashboard';

interface DeltaHeaderProps {
  delta: DashboardDelta;
  onReviewAll: () => void;
  isReviewing?: boolean;
}

export function DeltaHeader({ delta, onReviewAll, isReviewing }: DeltaHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{delta.since_label}</p>
      </div>
      {delta.new_alerts_count > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5">
            <Bell className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-sm font-medium text-amber-700">
              {delta.new_alerts_count} new alert{delta.new_alerts_count !== 1 ? 's' : ''}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground gap-1.5"
            onClick={onReviewAll}
            disabled={isReviewing}
          >
            <CheckCheck className="h-4 w-4" />
            Mark all reviewed
          </Button>
        </div>
      )}
    </div>
  );
}
