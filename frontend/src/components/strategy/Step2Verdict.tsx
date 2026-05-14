import { useState } from 'react';
import type * as React from 'react';

import Markdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { InfoTooltip } from '@/components/common/InfoTooltip';
import { TOOLTIPS } from '@/lib/ui-copy';
import { Check, AlertTriangle, X, ChevronLeft, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useStrategyStore } from '@/store/strategyStore';
import type { BriefMode, ConversionTier, EventVerdict } from '@/types/strategy';

const VERDICT_TOOLTIP: Record<EventVerdict, (typeof TOOLTIPS)[keyof typeof TOOLTIPS]> = {
  CONFIRM: TOOLTIPS.strategyVerdict_CONFIRM,
  AUGMENT: TOOLTIPS.strategyVerdict_AUGMENT,
  REPLACE: TOOLTIPS.strategyVerdict_REPLACE,
};

const VERDICT_CONFIG: Record<
  EventVerdict,
  { label: string; icon: React.ElementType; badgeClass: string; borderClass: string; accentClass: string }
> = {
  CONFIRM: {
    label: 'Keep current event',
    icon: Check,
    badgeClass: 'bg-green-100 text-green-800',
    borderClass: 'border-l-4 border-l-green-500',
    accentClass: 'bg-green-50 border-green-200',
  },
  AUGMENT: {
    label: 'Add proxy event',
    icon: AlertTriangle,
    badgeClass: 'bg-yellow-100 text-yellow-800',
    borderClass: 'border-l-4 border-l-yellow-500',
    accentClass: 'bg-yellow-50 border-yellow-200',
  },
  REPLACE: {
    label: 'Switch conversion event',
    icon: X,
    badgeClass: 'bg-red-100 text-red-800',
    borderClass: 'border-l-4 border-l-red-500',
    accentClass: 'bg-red-50 border-red-200',
  },
};

const TIER_CONFIG: Record<ConversionTier, { label: string; chipClass: string; description: string }> = {
  primary:     { label: 'Primary signal',     chipClass: 'bg-blue-100 text-blue-800',  description: 'Bid on this event — set as primary conversion action in each platform.' },
  secondary:   { label: 'Secondary signal',   chipClass: 'bg-slate-100 text-slate-700', description: 'Observe only — useful for diagnostics but do not optimise toward it.' },
  suppression: { label: 'Suppression signal', chipClass: 'bg-red-100 text-red-700',    description: 'Do not use as a conversion — would mislead Smart Bidding.' },
};

const CRM_KEYWORDS = ['sql', 'mql', 'opportunity', 'closed_won', 'closed won', 'qualified_lead', 'pipeline', 'offline', 'crm', 'deal', 'sales qualified', 'marketing qualified'];

function isCrmStageEvent(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return CRM_KEYWORDS.some((k) => lower.includes(k));
}

const TIMING_LABEL: Record<number, string> = {
  0: 'Same day',
  2: '1–3 days',
  5: '4–7 days',
  14: '1–4 weeks',
  45: '1–3 months',
  120: 'Longer than 3 months',
};

interface Step2VerdictProps {
  objectiveId: string;
  mode: BriefMode;
  onLocked: () => void;
  onEditInputs: () => void;
}

export function Step2Verdict({ objectiveId, mode, onLocked, onEditInputs }: Step2VerdictProps) {
  const { activeBrief, lockObjective, lockBrief } = useStrategyStore();
  const navigate = useNavigate();
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const obj = activeBrief?.objectives.find((o) => o.id === objectiveId);
  if (!obj) return null;

  const verdictCfg = obj.verdict ? VERDICT_CONFIG[obj.verdict] : null;
  const VerdictIcon = verdictCfg?.icon ?? Check;

  async function handleLock() {
    setLocking(true);
    setError(null);
    try {
      await lockObjective(objectiveId);
      if (mode === 'single' && activeBrief) {
        await lockBrief(activeBrief.id);
      }
      onLocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversion strategy evaluation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review the analysis and lock this objective to proceed.
        </p>
      </div>

      {/* Inputs summary */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Your inputs</p>
        {obj.description && (
          <p><span className="font-medium">Outcome: </span>{obj.description}</p>
        )}
        {obj.current_event && obj.current_event !== 'None' && (
          <p><span className="font-medium">Current event: </span>{obj.current_event}</p>
        )}
        {obj.outcome_timing_days != null && (
          <p>
            <span className="font-medium">Timing: </span>
            {TIMING_LABEL[obj.outcome_timing_days] ?? `${obj.outcome_timing_days} days`}
          </p>
        )}
        {obj.platforms && obj.platforms.length > 0 && (
          <p><span className="font-medium">Platforms: </span>{obj.platforms.join(', ')}</p>
        )}
      </div>

      {verdictCfg && (
        <>
          {/* Verdict block */}
          <div className={cn('rounded-lg border p-5', verdictCfg.accentClass)}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold',
                  verdictCfg.badgeClass,
                )}
              >
                <VerdictIcon className="size-4" />
                {verdictCfg.label}
              </div>
              {obj.verdict && <InfoTooltip entry={VERDICT_TOOLTIP[obj.verdict]} side="right" />}
            </div>
            {obj.rationale && (
              <p className="text-sm text-foreground/80">{obj.rationale}</p>
            )}
          </div>

          {/* Measurement governance tier */}
          {obj.conversion_tier && (() => {
            const tierCfg = TIER_CONFIG[obj.conversion_tier];
            return (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', tierCfg.chipClass)}>
                    {tierCfg.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{tierCfg.description}</span>
                </div>
                {obj.platform_action_types && Object.keys(obj.platform_action_types).length > 0 && (
                  <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs space-y-1">
                    <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1.5">Platform settings</p>
                    {Object.entries(obj.platform_action_types).map(([platform, action]) => (
                      <div key={platform} className="flex items-center gap-2">
                        <span className="font-medium capitalize min-w-[90px]">{platform.replace('_', ' ')}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{action}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Event cards */}
          {(obj.recommended_primary_event || obj.proxy_event_required) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {obj.recommended_primary_event && (
                <Card className={cn('overflow-hidden', verdictCfg.borderClass)}>
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Recommended Event
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="font-semibold">{obj.recommended_primary_event}</p>
                  </CardContent>
                </Card>
              )}
              {obj.proxy_event_required && obj.recommended_proxy_event && (
                <Card className="overflow-hidden border-l-4 border-l-amber-400">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                      Proxy Event
                      <InfoTooltip entry={TOOLTIPS.proxyEvent} side="right" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="font-semibold">{obj.recommended_proxy_event}</p>
                    <p className="mt-1 text-xs text-amber-700">
                      Your outcome fires after the attribution window. This proxy fires sooner and
                      predicts the downstream result.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* OCI nudge — shown when the recommended primary event is a CRM stage */}
          {isCrmStageEvent(obj.recommended_primary_event) && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <span className="mt-0.5 text-amber-500 text-lg leading-none">⚡</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">This event fires in your CRM, not on the website</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  To credit this conversion back to your campaigns, you'll need to import it via Offline Conversion Import (OCI).
                  Atlas has a built-in OCI pipeline for Google Ads.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/integrations/capi')}
                  className="mt-2 h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                >
                  Set up Offline Conversion Import →
                </Button>
              </div>
            </div>
          )}

          {/* Summary markdown */}
          {obj.summary_markdown && (
            <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm leading-relaxed text-foreground [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
              <Markdown>{obj.summary_markdown}</Markdown>
            </div>
          )}
        </>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Button onClick={handleLock} disabled={locking} className="flex-1">
            {locking ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Locking…
              </>
            ) : (
              <>
                <Lock className="mr-2 size-4" />
                Lock this objective
              </>
            )}
          </Button>
          <InfoTooltip entry={TOOLTIPS.lockBrief} side="left" />
        </div>
        <Button variant="outline" onClick={onEditInputs} disabled={locking} className="w-full">
          <ChevronLeft className="mr-1 size-4" />
          Edit inputs
        </Button>
      </div>
    </div>
  );
}
