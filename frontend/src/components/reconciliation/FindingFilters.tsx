import type { FindingFilters } from '@/lib/api/reconciliationApi';

interface FindingFiltersProps {
  filters: FindingFilters;
  onChange: (filters: FindingFilters) => void;
}

const DIMENSIONS = ['delivery', 'config', 'alignment', 'volume'] as const;
const SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
const PLATFORMS = [
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'meta', label: 'Meta' },
  { value: 'ga4', label: 'GA4' },
] as const;

export function FindingFilters({ filters, onChange }: FindingFiltersProps) {
  function set(patch: Partial<FindingFilters>) {
    const next = { ...filters, ...patch };
    // Clear undefined values
    (Object.keys(next) as (keyof FindingFilters)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    onChange(next);
  }

  const selectCls = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-full border font-medium cursor-pointer transition-colors ${
      active
        ? 'bg-[#1B2A4A] text-white border-[#1B2A4A]'
        : 'bg-white text-[#6B7280] border-[#D1D5DB] hover:border-[#9CA3AF]'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
      {/* Dimension */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-[#9CA3AF] font-medium">Dimension</span>
        {DIMENSIONS.map((d) => (
          <button
            key={d}
            onClick={() => set({ dimension: filters.dimension === d ? undefined : d })}
            className={selectCls(filters.dimension === d)}
          >
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>

      {/* Severity */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-[#9CA3AF] font-medium">Severity</span>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => set({ severity: filters.severity === s ? undefined : s })}
            className={selectCls(filters.severity === s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Platform */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-[#9CA3AF] font-medium">Platform</span>
        {PLATFORMS.map((p) => (
          <button
            key={p.value}
            onClick={() => set({ platform: filters.platform === p.value ? undefined : p.value })}
            className={selectCls(filters.platform === p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Resolved toggle */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[#9CA3AF] font-medium">Show</span>
        <button
          onClick={() => set({ resolved: filters.resolved === false ? undefined : false })}
          className={selectCls(filters.resolved === false)}
        >
          Open
        </button>
        <button
          onClick={() => set({ resolved: filters.resolved === true ? undefined : true })}
          className={selectCls(filters.resolved === true)}
        >
          Resolved
        </button>
      </div>

      {Object.keys(filters).length > 0 && (
        <button
          onClick={() => onChange({})}
          className="text-xs text-[#9CA3AF] hover:text-[#6B7280] underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
