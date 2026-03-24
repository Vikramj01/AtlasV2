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

const SEVERITY_CONFIG = {
  critical: {
    icon: XCircle,
    iconClass: 'text-red-500',
    border: 'border-l-red-500',
    badge: 'bg-red-100 text-red-700',
    label: 'Critical',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-amber-500',
    border: 'border-l-amber-500',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Warning',
  },
  info: {
    icon: Info,
    iconClass: 'text-blue-500',
    border: 'border-l-blue-500',
    badge: 'bg-blue-100 text-blue-700',
    label: 'Info',
  },
};

interface DiagnosticCardProps {
  diagnostic: ChannelDiagnostic;
  onResolve?: (id: string) => void;
  resolving?: boolean;
}

export function DiagnosticCard({ diagnostic, onResolve, resolving }: DiagnosticCardProps) {
  const config = SEVERITY_CONFIG[diagnostic.severity];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border border-l-4 ${config.border} bg-card px-4 py-3 space-y-2`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${config.iconClass}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug">{diagnostic.title}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${config.badge}`}>
                {config.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {CHANNEL_LABELS[diagnostic.channel] ?? diagnostic.channel}
              </span>
              <span className="text-[10px] text-muted-foreground">
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
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Resolve
          </button>
        )}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed pl-6">{diagnostic.description}</p>

      {/* Recommended action */}
      {diagnostic.recommended_action && (
        <div className="pl-6">
          <p className="text-xs font-medium text-foreground">Recommended action</p>
          <p className="text-xs text-muted-foreground mt-0.5">{diagnostic.recommended_action}</p>
        </div>
      )}

      {/* Affected pages + estimated impact */}
      {(diagnostic.affected_pages.length > 0 || diagnostic.estimated_impact) && (
        <div className="pl-6 flex gap-4 text-[11px] text-muted-foreground/70">
          {diagnostic.estimated_impact && (
            <span>Impact: {diagnostic.estimated_impact}</span>
          )}
          {diagnostic.affected_pages.length > 0 && (
            <span>{diagnostic.affected_pages.length} page(s) affected</span>
          )}
        </div>
      )}
    </div>
  );
}
