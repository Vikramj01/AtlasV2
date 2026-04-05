'use client';

import { useNavigate } from 'react-router-dom';
import { MapPin, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown when the user has no audit or CAPI data yet.
 * Directs them to the two most impactful first steps.
 */
export function EmptyState() {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-dashed bg-background px-6 py-12 flex flex-col items-center text-center gap-6">
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-foreground">No data yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Run your first tracking setup or audit to start seeing action cards and health metrics here.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          variant="default"
          className="gap-2"
          onClick={() => navigate('/planning/new')}
        >
          <MapPin className="h-4 w-4" />
          Set up tracking
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => navigate('/journey/new')}
        >
          <Zap className="h-4 w-4" />
          Verify a journey
        </Button>
      </div>
    </div>
  );
}

/** Shown when the API call fails */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-dashed bg-background px-6 py-10 flex flex-col items-center text-center gap-4">
      <p className="text-sm text-muted-foreground">
        Could not load dashboard data. Check your connection and try again.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
