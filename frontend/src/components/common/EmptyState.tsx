/**
 * EmptyState — minimal navy line-art empty state component.
 *
 * Design spec: "Empty States: Use minimal navy line art."
 *
 * Usage:
 *   <EmptyState
 *     icon="signals"
 *     title="No signals yet"
 *     description="Run your first scan to discover tracking opportunities."
 *     action={<Button>Run Scan</Button>}
 *   />
 */

import { cn } from '@/lib/utils';

// ── Illustration variants ─────────────────────────────────────────────────────

type IllustrationType =
  | 'signals'    // signal / waveform — for tracking maps, signal libraries
  | 'chart'      // line chart — for dashboards, analytics
  | 'search'     // magnifying glass — for search results, scans
  | 'document'   // document / report — for reports, outputs
  | 'connect'    // plug / connection — for integrations, CAPI
  | 'check'      // checklist — for journeys, verifications
  | 'generic';   // default

const NAVY = '#1B2A4A';
const NAVY_LIGHT = '#CDD4E5';

const ILLUSTRATIONS: Record<IllustrationType, React.ReactNode> = {
  signals: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Waveform bars */}
      <rect x="8"  y="32" width="8" height="24" rx="2" fill={NAVY_LIGHT} />
      <rect x="20" y="20" width="8" height="36" rx="2" fill={NAVY} />
      <rect x="32" y="12" width="8" height="44" rx="2" fill={NAVY} opacity="0.8" />
      <rect x="44" y="24" width="8" height="32" rx="2" fill={NAVY} opacity="0.6" />
      <rect x="56" y="36" width="8" height="20" rx="2" fill={NAVY_LIGHT} />
      <rect x="68" y="28" width="8" height="28" rx="2" fill={NAVY_LIGHT} />
      {/* Baseline */}
      <line x1="4" y1="60" x2="76" y2="60" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  chart: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Axes */}
      <path d="M12 8 L12 56 L72 56" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      {/* Grid lines */}
      <line x1="12" y1="40" x2="70" y2="40" stroke={NAVY_LIGHT} strokeWidth="1" strokeDasharray="3 3" />
      <line x1="12" y1="24" x2="70" y2="24" stroke={NAVY_LIGHT} strokeWidth="1" strokeDasharray="3 3" />
      {/* Line chart */}
      <polyline
        points="18,48 30,38 42,28 54,34 66,18"
        stroke={NAVY}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Dots */}
      {[
        [18, 48], [30, 38], [42, 28], [54, 34], [66, 18],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill={NAVY} />
      ))}
    </svg>
  ),

  search: (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Circle */}
      <circle cx="30" cy="30" r="20" stroke={NAVY} strokeWidth="2" fill="none" />
      {/* Inner detail lines */}
      <line x1="22" y1="30" x2="38" y2="30" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="30" y1="22" x2="30" y2="38" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      {/* Handle */}
      <line x1="45" y1="45" x2="60" y2="60" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),

  document: (
    <svg width="64" height="72" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Page */}
      <rect x="8" y="4" width="48" height="60" rx="4" stroke={NAVY} strokeWidth="1.5" fill="none" />
      {/* Folded corner */}
      <path d="M44 4 L56 16" stroke={NAVY} strokeWidth="1.5" />
      <path d="M44 4 L44 16 L56 16" stroke={NAVY_LIGHT} strokeWidth="1.5" fill={NAVY_LIGHT} fillOpacity="0.3" />
      {/* Lines */}
      <line x1="16" y1="28" x2="48" y2="28" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="38" x2="48" y2="38" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="48" x2="36" y2="48" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  connect: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Left node */}
      <rect x="4"  y="22" width="20" height="20" rx="4" stroke={NAVY} strokeWidth="1.5" fill="none" />
      {/* Right node */}
      <rect x="56" y="22" width="20" height="20" rx="4" stroke={NAVY} strokeWidth="1.5" fill="none" />
      {/* Dashed connection */}
      <line x1="24" y1="32" x2="56" y2="32" stroke={NAVY_LIGHT} strokeWidth="1.5" strokeDasharray="4 3" strokeLinecap="round" />
      {/* Plus in centre */}
      <circle cx="40" cy="32" r="8" stroke={NAVY} strokeWidth="1.5" fill="white" />
      <line x1="40" y1="27" x2="40" y2="37" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="35" y1="32" x2="45" y2="32" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),

  check: (
    <svg width="64" height="72" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* List rows */}
      {[16, 30, 44, 58].map((y) => (
        <g key={y}>
          <rect x="4" y={y - 6} width="12" height="12" rx="2" stroke={NAVY_LIGHT} strokeWidth="1.5" fill="none" />
          <line x1="22" y1={y} x2="60" y2={y} stroke={NAVY_LIGHT} strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
      {/* Check on first row */}
      <path d="M7 10 L10 13 L16 7" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  generic: (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="32" cy="32" r="28" stroke={NAVY_LIGHT} strokeWidth="1.5" fill="none" />
      <circle cx="32" cy="24" r="6" stroke={NAVY} strokeWidth="1.5" fill="none" />
      <path d="M20 48 C20 40 44 40 44 48" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  ),
};

// ── Component ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: IllustrationType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Compact variant — smaller padding, used inside cards */
  compact?: boolean;
}

export function EmptyState({
  icon = 'generic',
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className,
      )}
    >
      {/* Illustration */}
      <div className="mb-4 opacity-80">
        {ILLUSTRATIONS[icon]}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-[#1A1A1A] mb-1">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-[#6B7280] leading-relaxed max-w-xs mb-4">
          {description}
        </p>
      )}

      {/* CTA */}
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
