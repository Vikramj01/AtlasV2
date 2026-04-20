import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { Check, AlertTriangle, X, Copy, CheckCheck, ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { StrategyBrief as StrategyBriefType, EventVerdict } from '@/types/strategy';

const VERDICT_CONFIG: Record<
  EventVerdict,
  { label: string; icon: React.ElementType; badgeClass: string; borderClass: string }
> = {
  CONFIRM: {
    label: 'Keep current event',
    icon: Check,
    badgeClass: 'bg-green-100 text-green-800',
    borderClass: 'border-l-4 border-l-green-500',
  },
  AUGMENT: {
    label: 'Add proxy event',
    icon: AlertTriangle,
    badgeClass: 'bg-yellow-100 text-yellow-800',
    borderClass: 'border-l-4 border-l-yellow-500',
  },
  REPLACE: {
    label: 'Switch conversion event',
    icon: X,
    badgeClass: 'bg-red-100 text-red-800',
    borderClass: 'border-l-4 border-l-red-500',
  },
};

interface StrategyBriefProps {
  brief: StrategyBriefType;
  onReset: () => void;
}

export function StrategyBrief({ brief, onReset }: StrategyBriefProps) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const verdict = VERDICT_CONFIG[brief.eventVerdict];
  const VerdictIcon = verdict.icon;

  function handleCopy() {
    navigator.clipboard.writeText(brief.summaryMarkdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your Conversion Strategy Brief</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Based on your stated outcome and current event setup.
        </p>
      </div>

      {/* Verdict badge */}
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold',
          verdict.badgeClass,
        )}
      >
        <VerdictIcon className="size-4" />
        {verdict.label}
      </div>

      {/* Rationale */}
      <p className="text-sm text-muted-foreground">{brief.verdictRationale}</p>

      {/* Summary markdown */}
      <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm leading-relaxed text-foreground [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1">
        <Markdown>{brief.summaryMarkdown}</Markdown>
      </div>

      {/* Event cards */}
      {(brief.recommendedEventName !== null || brief.proxyEventRequired) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Recommended event card */}
          {brief.recommendedEventName !== null && (
            <Card className={cn('overflow-hidden', verdict.borderClass)}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Recommended Event
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="font-semibold">{brief.recommendedEventName}</p>
                {brief.recommendedEventRationale && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {brief.recommendedEventRationale}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Proxy event card */}
          {brief.proxyEventRequired && brief.proxyEventName && (
            <Card className="overflow-hidden border-l-4 border-l-amber-400">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Proxy Event Recommendation
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="font-semibold">{brief.proxyEventName}</p>
                <p className="mt-1 text-xs text-amber-700">
                  Your outcome typically fires after the attribution window. This proxy event fires
                  sooner and predicts the downstream result.
                </p>
                {brief.proxyEventRationale && (
                  <p className="mt-2 text-xs text-muted-foreground">{brief.proxyEventRationale}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button variant="outline" onClick={handleCopy} className="flex-1">
          {copied ? (
            <>
              <CheckCheck className="mr-2 size-4 text-green-600" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-2 size-4" />
              Copy brief
            </>
          )}
        </Button>
        <Button onClick={() => navigate('/planning')} className="flex-1">
          Start site scan
          <ArrowRight className="ml-2 size-4" />
        </Button>
      </div>

      {/* Start over */}
      <div className="text-center">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          Start over
        </button>
      </div>
    </div>
  );
}
