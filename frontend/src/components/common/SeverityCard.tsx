/**
 * SeverityCard — base card wrapper with a 3px left border coloured by severity.
 *
 * Design spec: "Use a 3px left border on cards for these states."
 *   Critical  → #DC2626  (red)
 *   Warning   → #D97706  (amber)
 *   Success   → #059669  (green)
 *   Info      → #2E75B6  (blue)
 *   Neutral   → #E5E7EB  (gray border, no tint)
 *
 * Usage:
 *   <SeverityCard severity="critical" title="Missing purchase event">
 *     <p>Detail text here</p>
 *   </SeverityCard>
 *
 *   // Without a built-in title — just wrap your own content:
 *   <SeverityCard severity="warning">
 *     <MyCustomContent />
 *   </SeverityCard>
 */

import { cn } from '@/lib/utils';

export type SeverityLevel = 'critical' | 'warning' | 'success' | 'info' | 'neutral';

interface SeverityCardProps {
  severity?: SeverityLevel;
  title?: string;
  className?: string;
  children?: React.ReactNode;
  /** Render as a compact row (less padding) */
  compact?: boolean;
}

// ── Style maps ───────────────────────────────────────────────────────────────

const BORDER_COLOR: Record<SeverityLevel, string> = {
  critical: 'border-l-[#DC2626]',
  warning:  'border-l-[#D97706]',
  success:  'border-l-[#059669]',
  info:     'border-l-[#2E75B6]',
  neutral:  'border-l-[#E5E7EB]',
};

const BG_TINT: Record<SeverityLevel, string> = {
  critical: 'bg-[#FEF2F2]',
  warning:  'bg-[#FFFBEB]',
  success:  'bg-[#F0FDF4]',
  info:     'bg-[#EFF6FF]',
  neutral:  'bg-white',
};

const TITLE_COLOR: Record<SeverityLevel, string> = {
  critical: 'text-red-700',
  warning:  'text-amber-700',
  success:  'text-emerald-700',
  info:     'text-blue-700',
  neutral:  'text-foreground',
};

const ICON: Record<SeverityLevel, string> = {
  critical: '●',
  warning:  '▲',
  success:  '✓',
  info:     'ℹ',
  neutral:  '',
};

// ── Component ────────────────────────────────────────────────────────────────

export function SeverityCard({
  severity = 'neutral',
  title,
  className,
  children,
  compact = false,
}: SeverityCardProps) {
  return (
    <div
      className={cn(
        // Base card styles
        'rounded-lg border border-[#E5E7EB] border-l-[3px]',
        // Severity-specific colours
        BORDER_COLOR[severity],
        BG_TINT[severity],
        // Padding
        compact ? 'px-3 py-2' : 'px-4 py-3',
        className,
      )}
    >
      {title && (
        <div className="flex items-center gap-2 mb-1">
          {severity !== 'neutral' && (
            <span
              className={cn('text-xs font-bold leading-none select-none', TITLE_COLOR[severity])}
              aria-hidden="true"
            >
              {ICON[severity]}
            </span>
          )}
          <span className={cn('text-sm font-semibold', TITLE_COLOR[severity])}>
            {title}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Convenience re-export of severity helpers ─────────────────────────────────

/** Map an arbitrary string status to a SeverityLevel. */
export function statusToSeverity(
  status: string | undefined | null,
): SeverityLevel {
  switch (status?.toLowerCase()) {
    case 'critical':
    case 'error':
    case 'failed':
      return 'critical';
    case 'warning':
    case 'degraded':
    case 'partial':
      return 'warning';
    case 'success':
    case 'healthy':
    case 'passed':
    case 'active':
      return 'success';
    case 'info':
    case 'pending':
    case 'processing':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Returns just the 3px border-left inline style — useful when you can't use SeverityCard directly. */
export function severityBorderStyle(severity: SeverityLevel): React.CSSProperties {
  const colors: Record<SeverityLevel, string> = {
    critical: '#DC2626',
    warning:  '#D97706',
    success:  '#059669',
    info:     '#2E75B6',
    neutral:  '#E5E7EB',
  };
  return { borderLeftWidth: '3px', borderLeftStyle: 'solid', borderLeftColor: colors[severity] };
}
