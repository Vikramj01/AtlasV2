import { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, X } from 'lucide-react';
import type { SignalFilters } from '@/types/signal-tracking';

// ── MultiSelectDropdown ───────────────────────────────────────────────────────

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  displayLabel?: (v: string) => string;
}

function MultiSelectDropdown({ label, options, selected, onChange, displayLabel }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const display = selected.length === 0
    ? label
    : selected.length === 1
      ? (displayLabel ? displayLabel(selected[0]) : selected[0])
      : `${label}: ${selected.length}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
          selected.length > 0
            ? 'border-[#1B2A4A] bg-[#1B2A4A] text-white'
            : 'border-[#E5E7EB] bg-white text-[#374151] hover:border-[#9CA3AF]',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {display}
        {selected.length > 0
          ? (
            <span
              role="button"
              aria-label={`Clear ${label} filter`}
              onClick={(e) => { e.stopPropagation(); onChange([]); }}
              className="ml-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </span>
          )
          : <ChevronDown className="h-3.5 w-3.5 opacity-60" />}
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          className="absolute top-full left-0 mt-1 z-20 min-w-[160px] rounded-md border border-[#E5E7EB] bg-white shadow-md py-1"
        >
          {options.map((opt) => (
            <button
              key={opt}
              role="option"
              aria-selected={selected.includes(opt)}
              onClick={() => toggle(opt)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-[#374151] hover:bg-[#F9FAFB]"
            >
              <span className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                selected.includes(opt) ? 'border-[#1B2A4A] bg-[#1B2A4A]' : 'border-[#D1D5DB]',
              )}>
                {selected.includes(opt) && (
                  <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 10 10">
                    <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {displayLabel ? displayLabel(opt) : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANGE_PRESETS = [
  { label: '1h',  value: '1h'  as const },
  { label: '24h', value: '24h' as const },
  { label: '7d',  value: '7d'  as const },
  { label: '30d', value: '30d' as const },
];

const DESTINATION_OPTIONS = ['meta', 'google', 'tiktok', 'linkedin', 'snapchat'];
const DESTINATION_LABELS: Record<string, string> = {
  meta:      'Meta',
  google:    'Google',
  tiktok:    'TikTok',
  linkedin:  'LinkedIn',
  snapchat:  'Snapchat',
};

const STATUS_OPTIONS = ['delivered', 'delivery_failed', 'dead_letter', 'received', 'consent_blocked', 'validated', 'prepared'];
const STATUS_LABELS: Record<string, string> = {
  delivered:        'Success',
  delivery_failed:  'Failed',
  dead_letter:      'Dead Letter',
  received:         'Received',
  consent_blocked:  'Consent Blocked',
  validated:        'Validated',
  prepared:         'Prepared',
};

const DEDUP_OPTIONS = ['hit', 'miss', 'not_applicable'];
const DEDUP_LABELS: Record<string, string> = {
  hit:             'Matched',
  miss:            'Unmatched',
  not_applicable:  'N/A',
};

// ── SignalFilterBar ───────────────────────────────────────────────────────────

interface Props {
  filters: SignalFilters;
  eventNameOptions: string[];
  onChange: (next: Partial<SignalFilters>) => void;
}

export function SignalFilterBar({ filters, eventNameOptions, onChange }: Props) {
  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[#E5E7EB] bg-white px-6 py-3"
      aria-label="Signal filters"
    >
      {/* Time range presets */}
      <div className="flex items-center gap-1 rounded-md border border-[#E5E7EB] p-0.5">
        {RANGE_PRESETS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onChange({ range: value })}
            aria-pressed={filters.range === value}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              filters.range === value
                ? 'bg-[#1B2A4A] text-white'
                : 'text-[#6B7280] hover:text-[#374151]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-[#E5E7EB]" aria-hidden />

      <MultiSelectDropdown
        label="Destination"
        options={DESTINATION_OPTIONS}
        selected={filters.destinations}
        onChange={(destinations) => onChange({ destinations })}
        displayLabel={(v) => DESTINATION_LABELS[v] ?? v}
      />

      <MultiSelectDropdown
        label="Event"
        options={eventNameOptions}
        selected={filters.event_names}
        onChange={(event_names) => onChange({ event_names })}
      />

      <MultiSelectDropdown
        label="Status"
        options={STATUS_OPTIONS}
        selected={filters.statuses}
        onChange={(statuses) => onChange({ statuses })}
        displayLabel={(v) => STATUS_LABELS[v] ?? v}
      />

      <MultiSelectDropdown
        label="Dedup"
        options={DEDUP_OPTIONS}
        selected={filters.dedup_statuses}
        onChange={(dedup_statuses) => onChange({ dedup_statuses })}
        displayLabel={(v) => DEDUP_LABELS[v] ?? v}
      />

      {/* Clear all */}
      {(filters.destinations.length > 0 || filters.event_names.length > 0 || filters.statuses.length > 0 || filters.dedup_statuses.length > 0) && (
        <button
          onClick={() => onChange({ destinations: [], event_names: [], statuses: [], dedup_statuses: [] })}
          className="text-xs text-[#6B7280] underline hover:text-[#374151]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
