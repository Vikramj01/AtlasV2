'use client';

import { cn } from '@/lib/utils';
import { ActionCard } from './ActionCard';
import type { DashboardCard } from '@/types/dashboard';

interface ActionCardListProps {
  cards: DashboardCard[];
  className?: string;
}

export function ActionCardList({ cards, className }: ActionCardListProps) {
  // Filter out success cards by default — they're reflected in the SummaryBar
  const actionableCards = cards.filter((c) => c.severity !== 'success');

  if (actionableCards.length === 0) {
    return (
      <div className={cn('rounded-xl border border-dashed bg-green-50/50 px-6 py-8 text-center', className)}>
        <p className="text-sm font-medium text-green-700">All systems healthy — no action required.</p>
        <p className="mt-1 text-xs text-muted-foreground">Atlas will surface issues here as they arise.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {actionableCards.map((card) => (
        <ActionCard key={card.id} card={card} />
      ))}
    </div>
  );
}

/** Loading skeleton for the card list */
export function ActionCardListSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 animate-pulse', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-muted/20 p-5 flex items-start gap-4">
          <div className="h-5 w-5 rounded-full bg-muted shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-4/5 rounded bg-muted" />
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="h-5 w-12 rounded bg-muted" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
