import { cn } from '@/lib/utils';
import { CardSkeleton } from '@/components/common/SkeletonCard';
import { ActionCard } from './ActionCard';
import type { DashboardCard } from '@/types/dashboard';

interface ActionCardListProps {
  cards: DashboardCard[];
  className?: string;
}

export function ActionCardList({ cards, className }: ActionCardListProps) {
  const actionableCards = cards.filter((c) => c.severity !== 'success');

  if (actionableCards.length === 0) {
    return (
      <div className={cn(
        'rounded-lg border border-[#059669]/30 bg-[#F0FDF4] px-6 py-6 flex items-center gap-3',
        className,
      )}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#059669] shrink-0" />
        <div>
          <p className="text-sm font-semibold text-[#059669]">All systems healthy — no action required.</p>
          <p className="text-xs text-[#6B7280] mt-0.5">Atlas will surface issues here as they arise.</p>
        </div>
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

/** Loading skeleton — uses Sprint 0 CardSkeleton */
export function ActionCardListSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
