import { FindingCard } from './FindingCard';
import { FindingFilters } from './FindingFilters';
import type { ReconciliationFinding, FindingFilters as FiltersType } from '@/lib/api/reconciliationApi';

interface FindingsListProps {
  findings: ReconciliationFinding[];
  filters: FiltersType;
  onFilterChange: (filters: FiltersType) => void;
  onResolve: (findingId: string) => void;
  resolvingId?: string | null;
  showFilters?: boolean;
}

export function FindingsList({
  findings,
  filters,
  onFilterChange,
  onResolve,
  resolvingId,
  showFilters = true,
}: FindingsListProps) {
  if (findings.length === 0 && Object.keys(filters).length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-8 text-center">
        <p className="text-sm text-[#9CA3AF]">No findings — everything looks aligned.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2">
          <FindingFilters filters={filters} onChange={onFilterChange} />
        </div>
      )}

      {findings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white px-6 py-6 text-center">
          <p className="text-sm text-[#9CA3AF]">No findings match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              onResolve={onResolve}
              isResolving={resolvingId === finding.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
