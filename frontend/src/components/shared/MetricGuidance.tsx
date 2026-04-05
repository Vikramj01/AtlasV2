'use client';

/**
 * MetricGuidance — reusable inline guidance component.
 *
 * Accepts a pre-computed GuidanceResult (from metricGuidance.ts) and renders
 * a compact callout block with summary, expandable detail, and an optional
 * action prompt.
 *
 * Usage:
 *   import { emqGuidance } from '@/lib/guidance/metricGuidance';
 *   import { MetricGuidance } from '@/components/shared/MetricGuidance';
 *   ...
 *   <MetricGuidance result={emqGuidance(dashboard.avg_emq)} />
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GuidanceResult, GuidanceSeverity } from '@/lib/guidance/metricGuidance';

const SEVERITY_STYLES: Record<GuidanceSeverity, {
  container: string;
  icon: string;
  action: string;
}> = {
  critical: {
    container: 'border-red-200 bg-red-50 text-red-900',
    icon: 'text-red-500',
    action: 'text-red-700 font-medium',
  },
  warn: {
    container: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: 'text-amber-500',
    action: 'text-amber-700 font-medium',
  },
  good: {
    container: 'border-green-200 bg-green-50 text-green-900',
    icon: 'text-green-500',
    action: 'text-green-700 font-medium',
  },
  neutral: {
    container: 'border-border bg-muted/30 text-foreground',
    icon: 'text-muted-foreground',
    action: 'text-muted-foreground font-medium',
  },
};

interface MetricGuidanceProps {
  result: GuidanceResult;
  /** Collapse the detail by default; user can expand. Defaults to false (expanded). */
  collapsible?: boolean;
  className?: string;
}

export function MetricGuidance({ result, collapsible = false, className }: MetricGuidanceProps) {
  const [expanded, setExpanded] = useState(!collapsible);
  const styles = SEVERITY_STYLES[result.severity];

  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', styles.container, className)}>
      {/* Summary row */}
      <div
        className={cn('flex items-start gap-2', collapsible && 'cursor-pointer select-none')}
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
      >
        <Lightbulb className={cn('h-4 w-4 mt-0.5 shrink-0', styles.icon)} />
        <span className="flex-1 font-medium leading-snug">{result.summary}</span>
        {collapsible && (
          expanded
            ? <ChevronUp className="h-4 w-4 shrink-0 mt-0.5 text-current opacity-50" />
            : <ChevronDown className="h-4 w-4 shrink-0 mt-0.5 text-current opacity-50" />
        )}
      </div>

      {/* Detail + action (shown when expanded) */}
      {expanded && (
        <div className="mt-2 pl-6 space-y-1.5">
          <p className="leading-relaxed opacity-90">{result.detail}</p>
          {result.action && (
            <p className={cn('text-xs', styles.action)}>
              → {result.action}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
