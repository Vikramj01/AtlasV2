/**
 * HomePage — Action Dashboard (Sprint 2)
 *
 * Replaces the old mode-selection page with a data-driven dashboard:
 *   SummaryBar → ActionCardList → IntelligentRouter
 *
 * Auto-refreshes every 5 minutes via dashboardStore.
 */

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useDashboardStore } from '@/store/dashboardStore';
import { SummaryBar, SummaryBarSkeleton } from '@/components/dashboard/SummaryBar';
import { ActionCardList, ActionCardListSkeleton } from '@/components/dashboard/ActionCardList';
import { IntelligentRouter } from '@/components/dashboard/IntelligentRouter';
import { EmptyState, ErrorState } from '@/components/dashboard/EmptyState';

export function HomePage() {
  const { data, loadState, lastFetchedAt, startPolling, fetch } = useDashboardStore();

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, [startPolling]);

  const isLoading = loadState === 'idle' || loadState === 'loading';
  const hasData = loadState === 'loaded' && data !== null;
  const isEmpty = loadState === 'loaded' && data !== null && data.cards.length === 0 && data.summary.signal_coverage_pct === null;
  const isError = loadState === 'error';

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lastFetchedAt
              ? `Updated ${lastFetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Loading your tracking health…'}
          </p>
        </div>
        {hasData && (
          <button
            onClick={fetch}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* Summary bar */}
      {isLoading && <SummaryBarSkeleton />}
      {hasData && !isEmpty && <SummaryBar summary={data!.summary} />}

      {/* Action cards */}
      {isLoading && <ActionCardListSkeleton count={3} />}
      {isError && <ErrorState onRetry={fetch} />}
      {isEmpty && <EmptyState />}
      {hasData && !isEmpty && <ActionCardList cards={data!.cards} />}

      {/* Intelligent router — always visible once loaded or on empty state */}
      {(hasData || isEmpty) && (
        <IntelligentRouter />
      )}

    </div>
  );
}
