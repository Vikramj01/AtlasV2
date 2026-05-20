import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, X } from 'lucide-react';
import { strategyApi } from '@/lib/api/strategyApi';
import { Button } from '@/components/ui/button';

const DISMISS_KEY = 'atlas_strategy_nudge_dismissed';

interface StrategyGateGuardProps {
  children: ReactNode;
}

/**
 * StrategyGateGuard — soft nudge encouraging users to set a conversion strategy
 * before running a site scan. Dismissable per session; never blocks access.
 */
export function StrategyGateGuard({ children }: StrategyGateGuardProps) {
  const navigate = useNavigate();
  const [showNudge, setShowNudge] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    strategyApi
      .listBriefs()
      .then((res) => {
        const hasLocked = (res.data ?? []).some((b) => b.locked_at !== null);
        if (!hasLocked) setShowNudge(true);
      })
      .catch(() => { /* fail open — never block the user */ });
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setShowNudge(false);
  }

  return (
    <>
      {showNudge && (
        <div className="flex items-center gap-3 border-b border-[#1B2A4A]/10 bg-[#EEF1F7] px-6 py-3">
          <Target className="h-4 w-4 shrink-0 text-[#1B2A4A]" />
          <p className="flex-1 text-sm text-[#1B2A4A]">
            <span className="font-medium">No conversion strategy set.</span>{' '}
            Defining your objective helps Atlas tailor scan recommendations to your campaign goals.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-7 bg-[#1B2A4A] text-xs text-white hover:bg-[#1B2A4A]/90"
              onClick={() => navigate('/planning/strategy')}
            >
              Set up strategy
            </Button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded p-1 text-[#1B2A4A]/50 transition-colors hover:bg-[#1B2A4A]/10"
              aria-label="Skip for now"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {children}
    </>
  );
}
