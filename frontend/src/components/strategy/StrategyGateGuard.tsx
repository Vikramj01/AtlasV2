import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { strategyApi } from '@/lib/api/strategyApi';
import { Button } from '@/components/ui/button';

interface StrategyGateGuardProps {
  children: ReactNode;
}

/**
 * StrategyGateGuard — blocks rendering of children until a strategy brief exists.
 * Redirects to /planning/strategy if none is found.
 */
export function StrategyGateGuard({ children }: StrategyGateGuardProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'locked' | 'open'>('loading');

  useEffect(() => {
    strategyApi
      .listBriefs()
      .then((res) => {
        const hasLocked = (res.data ?? []).some((b) => b.locked_at !== null);
        setStatus(hasLocked ? 'open' : 'locked');
      })
      .catch(() => setStatus('open')); // fail open — backend enforces the real gate
  }, []);

  if (status === 'loading') return null;

  if (status === 'locked') {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-300 bg-amber-50 px-8 py-16 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <Lock className="h-6 w-6 text-amber-600" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">Lock your conversion event first</h3>
        <p className="mb-6 max-w-sm text-sm text-muted-foreground">
          Before scanning or building a tracking plan, you need to define your conversion objective.
          This takes about 3 minutes.
        </p>
        <Button
          className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
          onClick={() => navigate('/planning/strategy')}
        >
          Lock my conversion event
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
