/**
 * DiagnosticCard — single channel diagnostic alert.
 *
 * Uses the 3px left border severity pattern from Sprint 0 (SeverityCard).
 * Severity colors aligned to the design system palette.
 */

import { AlertTriangle, Info, XCircle, CheckCircle2 } from 'lucide-react';
import type { ChannelDiagnostic, ChannelType } from '@/types/channel';

const CHANNEL_LABELS: Record<ChannelType, string> = {
  google_ads:        'Google Ads',
  meta_ads:          'Meta Ads',
  tiktok_ads:        'TikTok Ads',
  linkedin_ads:      'LinkedIn Ads',
  organic_search:    'Organic Search',
  paid_search_other: 'Paid Search (Other)',
  organic_social:    'Organic Social',
  paid_social_other: 'Paid Social (Other)',
  email:             'Email',
  referral:          'Referral',
  direct:            'Direct',
  other:             'Other',
};

// Design system severity palette
const SEVERITY_CONFIG = {
  critical: {
    Icon:       XCircle,
    iconColor:  '#DC2626',
    bg:         '#FEF2F2',
    border:     '#DC2626',
    badgeBg:    '#FEE2E2',
    badgeColor: '#DC2626',
    label:      'Critical',
  },
  warning: {
    Icon:       AlertTriangle,
    iconColor:  '#D97706',
    bg:         '#FFFBEB',
    border:     '#D97706',
    badgeBg:    '#FEF3C7',
    badgeColor: '#D97706',
    label:      'Warning',
  },
  info: {
    Icon:       Info,
    iconColor:  '#1B2A4A',
    bg:         '#EEF1F7',
    border:     '#1B2A4A',
    badgeBg:    '#EEF1F7',
    badgeColor: '#1B2A4A',
    label:      'Info',
  },
};

interface DiagnosticCardProps {
  diagnostic: ChannelDiagnostic;
  onResolve?: (id: string) => void;
  resolving?: boolean;
}

export function DiagnosticCard({ diagnostic, onResolve, resolving }: DiagnosticCardProps) {
  const config = SEVERITY_CONFIG[diagnostic.severity];
  const Icon = config.Icon;

  return (
    <div
      className="rounded-lg border bg-white overflow-hidden"
      style={{
        borderColor: '#E5E7EB',
        borderLeftColor: config.border,
        borderLeftWidth: 3,
        backgroundColor: config.bg,
      }}
    >
      <div className="px-4 py-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <Icon className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.5} style={{ color: config.iconColor }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#1A1A1A] leading-snug">{diagnostic.title}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: config.badgeBg, color: config.badgeColor }}
                >
                  {config.label}
                </span>
                <span className="text-[10px] text-[#9CA3AF]">
                  {CHANNEL_LABELS[diagnostic.channel] ?? diagnostic.channel}
                </span>
                <span className="text-[10px] text-[#9CA3AF]">
                  {new Date(diagnostic.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {onResolve && (
            <button
              type="button"
              onClick={() => onResolve(diagnostic.id)}
              disabled={resolving}
              className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#059669] transition-colors shrink-0 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              {resolving ? 'Resolving…' : 'Resolve'}
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-[#6B7280] leading-relaxed pl-7">{diagnostic.description}</p>

        {/* Recommended action */}
        {diagnostic.recommended_action && (
          <div className="pl-7">
            <p className="text-xs font-semibold text-[#1A1A1A]">Recommended action</p>
            <p className="text-xs text-[#6B7280] mt-0.5">{diagnostic.recommended_action}</p>
          </div>
        )}

        {/* Meta row */}
        {(diagnostic.affected_pages.length > 0 || diagnostic.estimated_impact) && (
          <div className="pl-7 flex gap-4 text-[11px] text-[#9CA3AF]">
            {diagnostic.estimated_impact && <span>Impact: {diagnostic.estimated_impact}</span>}
            {diagnostic.affected_pages.length > 0 && (
              <span>{diagnostic.affected_pages.length} page(s) affected</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
