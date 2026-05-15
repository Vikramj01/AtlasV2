import { AlertTriangle, XCircle, Info, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ReconciliationFinding } from '@/lib/api/reconciliationApi';

const SEVERITY_CONFIG = {
  critical: { icon: XCircle,       color: 'text-red-600',    bg: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-700' },
  error:    { icon: XCircle,       color: 'text-red-500',    bg: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-600' },
  warning:  { icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200',badge: 'bg-amber-100 text-amber-700' },
  info:     { icon: Info,          color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200',  badge: 'bg-blue-100 text-blue-700' },
} as const;

const DIMENSION_LABELS: Record<string, string> = {
  delivery:  'Delivery',
  config:    'Config',
  alignment: 'Alignment',
  volume:    'Volume',
};

const PLATFORM_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  meta:       'Meta',
  ga4:        'GA4',
};

interface FindingCardProps {
  finding: ReconciliationFinding;
  onResolve: (id: string) => void;
  isResolving?: boolean;
}

export function FindingCard({ finding, onResolve, isResolving = false }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.info;
  const Icon = config.icon;
  const isResolved = finding.resolved_at !== null;

  return (
    <div className={`rounded-lg border px-4 py-3 ${isResolved ? 'opacity-50 bg-white border-[#E5E7EB]' : config.bg}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
                {finding.severity}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                {DIMENSION_LABELS[finding.dimension] ?? finding.dimension}
              </span>
              <span className="text-xs text-[#9CA3AF]">
                {PLATFORM_LABELS[finding.platform] ?? finding.platform}
              </span>
              <code className="text-xs text-[#6B7280] font-mono">{finding.finding_code}</code>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isResolved ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Resolved
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(finding.id)}
                  disabled={isResolving}
                  className="h-7 text-xs"
                >
                  Resolve
                </Button>
              )}
            </div>
          </div>

          <p className="text-sm text-[#1B2A4A] mt-1.5 font-medium leading-snug">
            {finding.narrative}
          </p>

          {finding.remediation_hint && (
            <p className="text-xs text-[#6B7280] mt-1">
              <strong className="text-[#4B5563]">Fix: </strong>
              {finding.remediation_hint}
            </p>
          )}

          {/* Expandable expected/observed detail */}
          {(finding.expected || finding.observed) && (
            <button
              onClick={() => setExpanded((v: boolean) => !v)}
              className="mt-2 flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#6B7280]"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expanded ? 'Hide' : 'Show'} details
            </button>
          )}

          {expanded && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {finding.expected && (
                <div>
                  <p className="text-xs font-medium text-[#6B7280] mb-1">Expected</p>
                  <pre className="text-xs bg-white/60 rounded p-2 overflow-auto max-h-24 text-[#1B2A4A]">
                    {JSON.stringify(finding.expected, null, 2)}
                  </pre>
                </div>
              )}
              {finding.observed && (
                <div>
                  <p className="text-xs font-medium text-[#6B7280] mb-1">Observed</p>
                  <pre className="text-xs bg-white/60 rounded p-2 overflow-auto max-h-24 text-[#1B2A4A]">
                    {JSON.stringify(finding.observed, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
