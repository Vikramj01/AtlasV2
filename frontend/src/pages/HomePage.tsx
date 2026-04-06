/**
 * HomePage — Action Dashboard.
 *
 * Layout: page header → 4-cell metric bar → action cards → entry points
 *
 * Design spec (Screen 1):
 *   "Priority: Action-oriented."
 *   "Metric Bar: 4 equal cells."
 *   "Action Cards: Must support dynamic severity (3px left border)."
 */

import { useEffect } from 'react';
import { RefreshCw, MapPin, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDashboardStore } from '@/store/dashboardStore';
import { SummaryBar, SummaryBarSkeleton } from '@/components/dashboard/SummaryBar';
import { ActionCardList, ActionCardListSkeleton } from '@/components/dashboard/ActionCardList';
import { IntelligentRouter } from '@/components/dashboard/IntelligentRouter';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

export function HomePage() {
  const { data, loadState, lastFetchedAt, startPolling, fetch } = useDashboardStore();
  const navigate = useNavigate();

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, [startPolling]);

  const isLoading = loadState === 'idle' || loadState === 'loading';
  const hasData   = loadState === 'loaded' && data !== null;
  const isEmpty   = hasData && data!.cards.length === 0 && data!.summary.signal_coverage_pct === null;
  const isError   = loadState === 'error';

  return (
    <div className="px-6 py-8 max-w-5xl space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-page-title">Dashboard</h1>
          <p className="mt-1 text-body text-[#6B7280]">
            {lastFetchedAt
              ? `Updated ${lastFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Loading your tracking health…'}
          </p>
        </div>

        {hasData && (
          <button
            onClick={fetch}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            Refresh
          </button>
        )}
      </div>

      {/* ── Metric bar (4 cells) ─────────────────────────────────────────── */}
      {isLoading && <SummaryBarSkeleton />}
      {hasData && !isEmpty && <SummaryBar summary={data!.summary} />}

      {/* ── Action cards ─────────────────────────────────────────────────── */}
      {isLoading && <ActionCardListSkeleton count={3} />}

      {isError && (
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-6 py-8 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[#6B7280]">
            Could not load dashboard data. Check your connection and try again.
          </p>
          <Button variant="secondary" size="sm" onClick={fetch}>Retry</Button>
        </div>
      )}

      {isEmpty && (
        <EmptyState
          icon="signals"
          title="No data yet"
          description="Run your first tracking setup or audit to start seeing action cards and health metrics here."
          action={
            <div className="flex gap-3">
              <Button onClick={() => navigate('/planning/new')} className="gap-2">
                <MapPin className="h-4 w-4" strokeWidth={1.5} />
                Set up tracking
              </Button>
              <Button variant="secondary" onClick={() => navigate('/journey/new')} className="gap-2">
                <Zap className="h-4 w-4" strokeWidth={1.5} />
                Verify a journey
              </Button>
            </div>
          }
        />
      )}

      {hasData && !isEmpty && <ActionCardList cards={data!.cards} />}

      {/* ── Entry points — always visible once loaded ─────────────────────── */}
      {(hasData || isEmpty) && <IntelligentRouter />}
    </div>
  );
}
