import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, ArrowRight, Plus, Download, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { strategyApi } from '@/lib/api/strategyApi';
import { useStrategyStore } from '@/store/strategyStore';
import type { EventVerdict } from '@/types/strategy';

const VERDICT_LABELS: Record<EventVerdict, string> = {
  CONFIRM: 'Keep current event',
  AUGMENT: 'Add proxy event',
  REPLACE: 'Switch conversion event',
};

const NEXT_STEPS_KEY = 'atlas_brief_nextsteps_dismissed';

interface BriefLockedProps {
  onNewBrief: () => void;
}

export function BriefLocked({ onNewBrief }: BriefLockedProps) {
  const navigate = useNavigate();
  const { activeBrief } = useStrategyStore();

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [nextStepsDismissed, setNextStepsDismissed] = useState(
    () => localStorage.getItem(NEXT_STEPS_KEY) === '1',
  );

  const objectives = activeBrief?.objectives ?? [];
  const briefId = activeBrief?.id;

  async function handleDownloadPdf() {
    if (!briefId) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const res = await strategyApi.exportBriefPdf(briefId);
      const a = document.createElement('a');
      a.href = res.data.url;
      a.download = res.data.filename;
      a.click();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setPdfLoading(false);
    }
  }

  function dismissNextSteps() {
    localStorage.setItem(NEXT_STEPS_KEY, '1');
    setNextStepsDismissed(true);
  }

  return (
    <div className="space-y-8">
      {/* Success header */}
      <div className="flex flex-col items-center text-center pt-4">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="size-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Your conversion strategy is locked</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Your Strategy Brief is ready. Share it with your team, hand it to a developer, or keep it
          for reference.
        </p>
      </div>

      {/* PDF download card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Download className="size-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">Download Strategy Brief</p>
            <p className="text-sm text-muted-foreground">
              A branded PDF covering all objectives, verdicts, and implementation notes.
            </p>
          </div>
        </div>

        {pdfError && (
          <Alert variant="destructive">
            <AlertDescription>{pdfError}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3 flex-wrap">
          <Button onClick={handleDownloadPdf} disabled={pdfLoading}>
            {pdfLoading ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />Generating PDF…</>
            ) : (
              <><Download className="mr-2 size-4" />Download PDF</>
            )}
          </Button>
          {briefId && (
            <Button variant="ghost" onClick={() => navigate(`/strategy/briefs/${briefId}`)}>
              <ExternalLink className="mr-2 size-4" />
              View in Atlas
            </Button>
          )}
        </div>
      </div>

      {/* Locked objectives summary */}
      {objectives.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Locked objectives
          </p>
          {objectives.map((obj) => (
            <div
              key={obj.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
            >
              <p className="text-sm font-medium">{obj.name}</p>
              {obj.verdict && (
                <span className="text-xs text-muted-foreground">{VERDICT_LABELS[obj.verdict]}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dismissible next steps strip */}
      {!nextStepsDismissed && (
        <div className="rounded-xl border border-border bg-muted/20 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">What to do next</p>
            <button
              type="button"
              onClick={dismissNextSteps}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                title: 'Run a site scan',
                description: 'See how your current tracking matches this strategy.',
                href: '/planning',
              },
              {
                title: 'Configure CAPI',
                description: 'Send your locked events server-side to Meta and Google.',
                href: '/integrations/capi',
              },
              {
                title: 'Set up consent',
                description: 'Make sure everything works under Consent Mode v2.',
                href: '/consent',
              },
            ].map((step) => (
              <button
                key={step.href}
                type="button"
                onClick={() => navigate(step.href)}
                className={cn(
                  'flex flex-col items-start rounded-lg border border-border bg-background p-4 text-left',
                  'hover:border-primary/40 hover:bg-muted/40 transition-colors',
                )}
              >
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                <span className="mt-3 text-xs text-primary font-medium">
                  Go <ArrowRight className="inline size-3" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create new brief */}
      <Button variant="outline" onClick={onNewBrief} className="w-full">
        <Plus className="mr-2 size-4" />
        Create a new brief
      </Button>
    </div>
  );
}
