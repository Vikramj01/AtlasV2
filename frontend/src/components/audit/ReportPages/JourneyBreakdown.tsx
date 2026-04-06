/**
 * JourneyBreakdown — Verify Journeys pass/fail node map.
 *
 * Design spec:
 *   "Pass/fail nodes connected by arrows. Navy ring on selected node."
 *   Pass:    green fill (#F0FDF4), green border (#059669), green label.
 *   Warning: amber fill (#FFFBEB), amber border (#D97706), amber label.
 *   Fail:    red fill (#FEF2F2),   red border (#DC2626),   red label.
 *
 * Horizontal funnel on desktop (overflow-x-auto), vertical list on mobile.
 * Click a node to expand its detail panel below the funnel.
 */

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReportJSON, JourneyStage, RuleStatus } from '@/types/audit';

// ── Status config — aligned to design system palette ──────────────────────────

const STATUS_CONFIG: Record<RuleStatus, {
  label:      string;
  bg:         string;
  border:     string;
  labelColor: string;
  Icon:       React.ElementType;
  iconColor:  string;
  panelBg:    string;
}> = {
  pass: {
    label:      'Healthy',
    bg:         '#F0FDF4',
    border:     '#059669',
    labelColor: '#059669',
    Icon:       CheckCircle2,
    iconColor:  '#059669',
    panelBg:    '#F0FDF4',
  },
  warning: {
    label:      'Warning',
    bg:         '#FFFBEB',
    border:     '#D97706',
    labelColor: '#D97706',
    Icon:       AlertTriangle,
    iconColor:  '#D97706',
    panelBg:    '#FFFBEB',
  },
  fail: {
    label:      'Critical',
    bg:         '#FEF2F2',
    border:     '#DC2626',
    labelColor: '#DC2626',
    Icon:       XCircle,
    iconColor:  '#DC2626',
    panelBg:    '#FEF2F2',
  },
};

const NAVY = '#1B2A4A';

// ── Single stage node ─────────────────────────────────────────────────────────

function StageNode({
  stage,
  active,
  onClick,
  isLast,
}: {
  stage: JourneyStage;
  active: boolean;
  onClick: () => void;
  isLast: boolean;
}) {
  const c = STATUS_CONFIG[stage.status];
  const Icon = c.Icon;

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col items-center gap-2 focus:outline-none group"
        title={`${stage.stage} — ${c.label}`}
      >
        {/* Node circle */}
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full border-2 transition-all"
          style={{
            backgroundColor: c.bg,
            borderColor: active ? NAVY : c.border,
            boxShadow: active
              ? `0 0 0 3px ${NAVY}20`
              : 'none',
          }}
        >
          <Icon className="h-6 w-6" strokeWidth={1.5} style={{ color: c.iconColor }} />
        </div>

        {/* Stage name */}
        <span
          className="text-xs font-medium text-center w-16 leading-tight"
          style={{ color: active ? NAVY : '#6B7280' }}
        >
          {stage.stage}
        </span>

        {/* Status label */}
        <span className="text-[10px] font-semibold" style={{ color: c.labelColor }}>
          {c.label}
        </span>
      </button>

      {/* Arrow connector */}
      {!isLast && (
        <div className="flex items-center mx-2 mb-8" aria-hidden="true">
          <div className="h-px w-6 sm:w-10" style={{ backgroundColor: '#E5E7EB' }} />
          <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
            <path d="M0 0L8 5L0 10V0Z" fill="#E5E7EB" />
          </svg>
        </div>
      )}
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function StagePanel({ stage, onClose }: { stage: JourneyStage; onClose: () => void }) {
  const c = STATUS_CONFIG[stage.status];
  const Icon = c.Icon;

  return (
    <div
      className="rounded-lg border-2 p-5"
      style={{ backgroundColor: c.panelBg, borderColor: c.border }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} style={{ color: c.iconColor }} />
          <div>
            <h3 className="text-section-header" style={{ color: '#1A1A1A' }}>
              {stage.stage} Stage
            </h3>
            <p className="text-xs font-semibold mt-0.5" style={{ color: c.labelColor }}>
              {c.label}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-black/5 transition-colors"
          aria-label="Close panel"
        >
          <X className="h-4 w-4 text-[#6B7280]" strokeWidth={1.5} />
        </button>
      </div>

      {stage.issues.length === 0 ? (
        <p className="text-sm" style={{ color: '#059669' }}>
          No issues detected at this stage.
        </p>
      ) : (
        <ul className="space-y-2">
          {stage.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[#6B7280]">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#DC2626]" strokeWidth={1.5} />
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  report: ReportJSON;
}

export function JourneyBreakdown({ report }: Props) {
  const [activeStage, setActiveStage] = useState<JourneyStage | null>(null);
  const { journey_stages } = report;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-page-title">Conversion Journey</h2>
        <p className="mt-1 text-body text-[#6B7280]">
          Click any stage to see what's happening — and what to fix.
        </p>
      </div>

      {/* ── Desktop: horizontal funnel with arrows ─────────────────────────── */}
      <div className="hidden sm:block rounded-lg border border-[#E5E7EB] bg-white px-6 py-6 overflow-x-auto">
        <div className="flex items-start justify-start min-w-max">
          {journey_stages.map((stage, i) => (
            <StageNode
              key={stage.stage}
              stage={stage}
              active={activeStage?.stage === stage.stage}
              onClick={() => setActiveStage(activeStage?.stage === stage.stage ? null : stage)}
              isLast={i === journey_stages.length - 1}
            />
          ))}
        </div>
      </div>

      {/* ── Mobile: vertical list ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:hidden">
        {journey_stages.map((stage) => {
          const c = STATUS_CONFIG[stage.status];
          const Icon = c.Icon;
          const isActive = activeStage?.stage === stage.stage;

          return (
            <button
              key={stage.stage}
              type="button"
              onClick={() => setActiveStage(isActive ? null : stage)}
              className="flex items-center gap-3 rounded-lg border-2 px-4 py-3 text-left transition-colors"
              style={{
                backgroundColor: c.bg,
                borderColor: isActive ? NAVY : c.border,
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} style={{ color: c.iconColor }} />
              <span className="flex-1 text-sm font-medium text-[#1A1A1A]">{stage.stage}</span>
              <span className="text-xs font-semibold" style={{ color: c.labelColor }}>{c.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Expanded detail panel ──────────────────────────────────────────── */}
      {activeStage && (
        <StagePanel stage={activeStage} onClose={() => setActiveStage(null)} />
      )}
    </div>
  );
}
