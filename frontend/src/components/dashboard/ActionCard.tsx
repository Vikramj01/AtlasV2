/**
 * ActionCard — individual action item on the Home Dashboard.
 *
 * Design spec:
 *   "Action Cards: Must support dynamic severity (3px left border)."
 *   Title: 16px semibold. Body: 14px.
 *
 * Uses SeverityCard from Sprint 0 for the 3px left border + tinted bg.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
import { SeverityCard } from '@/components/common/SeverityCard';
import type { SeverityLevel } from '@/components/common/SeverityCard';
import type { DashboardCard, CardSeverity } from '@/types/dashboard';

// Map dashboard severity → SeverityCard's SeverityLevel
const SEVERITY_MAP: Record<CardSeverity, SeverityLevel> = {
  critical: 'critical',
  warning:  'warning',
  success:  'success',
  info:     'info',
};

// Badge colours per severity (sits next to the title)
const BADGE_STYLES: Record<CardSeverity, string> = {
  critical: 'bg-[#FEF2F2] text-[#DC2626] border border-[#DC2626]/20',
  warning:  'bg-[#FFFBEB] text-[#D97706] border border-[#D97706]/20',
  info:     'bg-[#EFF6FF] text-[#2E75B6] border border-[#2E75B6]/20',
  success:  'bg-[#F0FDF4] text-[#059669] border border-[#059669]/20',
};

const BADGE_LABELS: Record<CardSeverity, string> = {
  critical: 'Critical',
  warning:  'Warning',
  info:     'Info',
  success:  'Healthy',
};

// CTA arrow colour
const CTA_COLOR: Record<CardSeverity, string> = {
  critical: 'text-[#DC2626]',
  warning:  'text-[#D97706]',
  info:     'text-[#2E75B6]',
  success:  'text-[#059669]',
};

interface ActionCardProps {
  card: DashboardCard;
}

export function ActionCard({ card }: ActionCardProps) {
  const navigate = useNavigate();
  const severity = SEVERITY_MAP[card.severity];

  return (
    <SeverityCard
      severity={severity}
      className="cursor-pointer transition-shadow duration-150 hover:shadow-sm"
      onClick={() => navigate(card.action_url)}
    >
      <div className="flex items-start gap-4">
        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {/* Title — 16px semibold per spec */}
            <span className="text-section-header text-[#1A1A1A]">{card.title}</span>
            {/* Severity badge */}
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BADGE_STYLES[card.severity]}`}>
              {BADGE_LABELS[card.severity]}
            </span>
          </div>
          {/* Message — 14px per spec */}
          <p className="text-body text-[#6B7280] leading-relaxed">{card.message}</p>
        </div>

        {/* Metric + CTA */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          {card.metric_value !== null && (
            <div className="flex items-center gap-1 text-[#1A1A1A]">
              <TrendingUp className="h-3.5 w-3.5 text-[#6B7280]" strokeWidth={1.5} />
              <span className="text-base font-bold tabular-nums">
                {Number.isInteger(card.metric_value)
                  ? `${card.metric_value}%`
                  : card.metric_value.toFixed(1)}
              </span>
            </div>
          )}
          <div className={`flex items-center gap-1 text-xs font-medium ${CTA_COLOR[card.severity]}`}>
            {card.action_label}
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </div>
        </div>
      </div>
    </SeverityCard>
  );
}
