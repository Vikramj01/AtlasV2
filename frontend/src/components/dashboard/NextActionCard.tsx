import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock } from 'lucide-react';
import { dashboardApi } from '@/lib/api/dashboardApi';
import type { NextAction } from '@/types/dashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SkeletonBlock } from '@/components/common/SkeletonCard';

const NAVY = '#1B2A4A';

export function NextActionCard() {
  const navigate = useNavigate();
  const [action, setAction] = useState<NextAction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi
      .getNextAction()
      .then((res) => setAction(res.data))
      .catch(() => setAction(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="border-[#1B2A4A]/20">
        <CardContent className="py-6 space-y-3">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-6 w-64" />
          <SkeletonBlock className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  if (!action) return null;

  const etaLabel =
    action.eta_minutes === 0
      ? 'Hand to developer'
      : `~${action.eta_minutes} min`;

  return (
    <Card
      className="overflow-hidden border-l-4"
      style={{ borderLeftColor: NAVY }}
    >
      <CardContent className="py-5 px-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Next action
            </p>
            <p className="text-base font-semibold text-[#1A1A1A]">{action.copy}</p>
            <div className="flex items-center gap-1 text-xs text-[#6B7280]">
              <Clock className="h-3 w-3 shrink-0" />
              {etaLabel}
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            style={{ backgroundColor: NAVY }}
            onClick={() => navigate(action.cta_route)}
          >
            Go
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
