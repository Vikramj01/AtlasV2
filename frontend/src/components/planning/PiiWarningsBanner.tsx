/**
 * PiiWarningsBanner — displays PII detection warnings in the Generated Outputs step.
 *
 * Fetches warnings from GET /api/planning/sessions/:id/pii-warnings and renders
 * them grouped by severity: high → medium → info.
 * Collapsed by default if only info-level warnings; expanded for high/medium.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Shield } from 'lucide-react';
import { planningApi } from '@/lib/api/planningApi';
import type { PiiWarning, PiiSeverity } from '@/types/planning';

interface PiiWarningsBannerProps {
  sessionId: string;
}

const SEVERITY_CONFIG: Record<PiiSeverity, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  rowClass: string;
  badgeClass: string;
}> = {
  high: {
    label: 'High',
    icon: AlertTriangle,
    rowClass: 'border-red-200 bg-red-50',
    badgeClass: 'bg-red-100 text-red-700',
  },
  medium: {
    label: 'Medium',
    icon: AlertCircle,
    rowClass: 'border-amber-200 bg-amber-50',
    badgeClass: 'bg-amber-100 text-amber-700',
  },
  info: {
    label: 'Info',
    icon: Info,
    rowClass: 'border-blue-200 bg-blue-50',
    badgeClass: 'bg-blue-100 text-blue-700',
  },
};

export function PiiWarningsBanner({ sessionId }: PiiWarningsBannerProps) {
  const [warnings, setWarnings] = useState<PiiWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    planningApi.getPiiWarnings(sessionId)
      .then(({ warnings: w }) => {
        setWarnings(w);
        // Auto-expand if there are high or medium warnings
        if (w.some(w => w.severity === 'high' || w.severity === 'medium')) {
          setExpanded(true);
        }
      })
      .catch(() => { /* non-blocking */ })
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading || warnings.length === 0) return null;

  const highCount = warnings.filter(w => w.severity === 'high').length;
  const mediumCount = warnings.filter(w => w.severity === 'medium').length;
  const infoCount = warnings.filter(w => w.severity === 'info').length;

  const headerColor = highCount > 0
    ? 'border-red-300 bg-red-50'
    : mediumCount > 0
      ? 'border-amber-300 bg-amber-50'
      : 'border-blue-300 bg-blue-50';

  const headerIconColor = highCount > 0 ? 'text-red-500' : mediumCount > 0 ? 'text-amber-500' : 'text-blue-500';

  return (
    <div className={`rounded-xl border ${headerColor} overflow-hidden`}>
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2.5">
          <Shield className={`h-4 w-4 shrink-0 ${headerIconColor}`} />
          <div>
            <p className="text-sm font-semibold">PII Detection Warnings</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[
                highCount > 0 && `${highCount} high`,
                mediumCount > 0 && `${mediumCount} medium`,
                infoCount > 0 && `${infoCount} info`,
              ].filter(Boolean).join(' · ')} — review before deploying
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {/* Warning list */}
      {expanded && (
        <div className="border-t border-inherit px-4 py-3 space-y-3">
          {(['high', 'medium', 'info'] as PiiSeverity[]).map(severity => {
            const sevWarnings = warnings.filter(w => w.severity === severity);
            if (sevWarnings.length === 0) return null;
            const config = SEVERITY_CONFIG[severity];
            const Icon = config.icon;
            return sevWarnings.map((warning, i) => (
              <div
                key={`${severity}-${i}`}
                className={`rounded-lg border px-3 py-3 ${config.rowClass}`}
              >
                <div className="flex items-start gap-2.5">
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${severity === 'high' ? 'text-red-500' : severity === 'medium' ? 'text-amber-500' : 'text-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase ${config.badgeClass}`}>
                        {config.label}
                      </span>
                      <code className="text-xs font-mono bg-white/60 px-1.5 py-0.5 rounded border border-white/40">
                        {warning.event_name}
                      </code>
                      {warning.field !== '(event)' && (
                        <code className="text-xs font-mono bg-white/60 px-1.5 py-0.5 rounded border border-white/40">
                          {warning.field}
                        </code>
                      )}
                    </div>
                    <p className="text-xs font-medium">{warning.message}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{warning.recommendation}</p>
                  </div>
                </div>
              </div>
            ));
          })}

          <p className="text-[11px] text-muted-foreground pt-1">
            Atlas CAPI automatically hashes PII (email, phone) before sending to ad platforms.{' '}
            <a href="/integrations/capi" className="underline hover:text-foreground">Set up CAPI →</a>
          </p>
        </div>
      )}
    </div>
  );
}
