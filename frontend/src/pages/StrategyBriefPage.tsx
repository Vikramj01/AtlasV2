import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import {
  Check,
  AlertTriangle,
  X,
  Download,
  Edit,
  Loader2,
  ChevronRight,
  Lock,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { strategyApi } from '@/lib/api/strategyApi';
import { useStrategyStore } from '@/store/strategyStore';
import type { StrategyBriefWithObjectives, EventVerdict } from '@/types/strategy';

const VERDICT_CONFIG: Record<EventVerdict, { label: string; icon: React.ElementType; badgeClass: string; borderClass: string }> = {
  CONFIRM: { label: 'Keep current event',      icon: Check,         badgeClass: 'bg-green-100 text-green-800',  borderClass: 'border-l-4 border-l-green-500' },
  AUGMENT: { label: 'Add proxy event',         icon: AlertTriangle, badgeClass: 'bg-yellow-100 text-yellow-800', borderClass: 'border-l-4 border-l-yellow-500' },
  REPLACE: { label: 'Switch conversion event', icon: X,             badgeClass: 'bg-red-100 text-red-800',      borderClass: 'border-l-4 border-l-red-500' },
};

const TIMING_LABEL: Record<number, string> = {
  0: 'Same day', 2: '1–3 days', 5: '4–7 days', 14: '1–4 weeks', 45: '1–3 months', 120: 'Longer than 3 months',
};

const PLATFORM_LABELS: Record<string, string> = {
  meta: 'Meta', google: 'Google Ads', linkedin: 'LinkedIn', tiktok: 'TikTok', other: 'Other',
};

export function StrategyBriefPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { createBriefVersion } = useStrategyStore();

  const [brief, setBrief] = useState<StrategyBriefWithObjectives | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [versionConfirmOpen, setVersionConfirmOpen] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    strategyApi.getBrief(id)
      .then((res) => setBrief(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load brief.'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDownloadPdf() {
    if (!id) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const res = await strategyApi.exportBriefPdf(id);
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

  async function handleCreateVersion() {
    if (!id) return;
    setVersionLoading(true);
    setVersionError(null);
    try {
      const newBrief = await createBriefVersion(id);
      setVersionConfirmOpen(false);
      navigate(`/strategy/briefs/${newBrief.id}`);
    } catch (err) {
      setVersionError(err instanceof Error ? err.message : 'Failed to create new version.');
    } finally {
      setVersionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !brief) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Brief not found.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const lockedDate = brief.locked_at
    ? new Date(brief.locked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10">
      {/* Back link */}
      <Link to="/planning/strategy" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Strategy
      </Link>

      {/* Superseded banner */}
      {brief.superseded_by && (
        <Alert>
          <AlertDescription>
            This brief has been superseded.{' '}
            <Link to={`/strategy/briefs/${brief.superseded_by}`} className="underline">
              View the newer version →
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
            Conversion Strategy Brief
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {brief.brief_name ?? 'Strategy Brief'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock className="size-3.5" />
              {lockedDate ? `Locked ${lockedDate}` : 'Draft'}
            </span>
            <span>v{brief.version_no}</span>
            <span>{brief.objectives.length} objective{brief.objectives.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {brief.locked_at && (
            <>
              <Button onClick={handleDownloadPdf} disabled={pdfLoading} variant="outline" size="sm">
                {pdfLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
                Download PDF
              </Button>
              {!brief.superseded_by && (
                <Button onClick={() => setVersionConfirmOpen(true)} variant="ghost" size="sm">
                  <Edit className="mr-2 size-4" />
                  Edit (create v{brief.version_no + 1})
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {pdfError && (
        <Alert variant="destructive">
          <AlertDescription>{pdfError}</AlertDescription>
        </Alert>
      )}

      {/* Objectives */}
      <div className="space-y-8">
        {brief.objectives.map((obj, i) => {
          const vc = obj.verdict ? VERDICT_CONFIG[obj.verdict] : null;
          const VerdictIcon = vc?.icon ?? Check;

          return (
            <div key={obj.id} className="rounded-xl border border-border overflow-hidden">
              {/* Objective header */}
              <div className="bg-muted/40 px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background border border-border text-xs font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <h2 className="font-semibold text-base">{obj.name}</h2>
                </div>
                {vc && (
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', vc.badgeClass)}>
                    <VerdictIcon className="size-3" />
                    {vc.label}
                  </span>
                )}
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* Inputs */}
                <div className="rounded-lg bg-muted/30 border border-border p-4 text-sm space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inputs</p>
                  {obj.description && (
                    <p><span className="font-medium">Outcome: </span>{obj.description}</p>
                  )}
                  {obj.current_event && obj.current_event !== 'None' && (
                    <p><span className="font-medium">Current event: </span>{obj.current_event}</p>
                  )}
                  {obj.outcome_timing_days != null && (
                    <p><span className="font-medium">Timing: </span>{TIMING_LABEL[obj.outcome_timing_days] ?? `${obj.outcome_timing_days} days`}</p>
                  )}
                  {obj.platforms.length > 0 && (
                    <p><span className="font-medium">Platforms: </span>{obj.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(', ')}</p>
                  )}
                </div>

                {/* Verdict block */}
                {vc && (
                  <div className={cn('rounded-lg border p-4', vc.borderClass)}>
                    {obj.recommended_primary_event && (
                      <p className="text-sm mb-2">
                        <span className="font-medium">Recommended event: </span>{obj.recommended_primary_event}
                      </p>
                    )}
                    {obj.proxy_event_required && obj.recommended_proxy_event && (
                      <p className="text-sm mb-2">
                        <span className="font-medium">Proxy event: </span>{obj.recommended_proxy_event}
                      </p>
                    )}
                    {obj.rationale && (
                      <p className="text-sm text-muted-foreground">{obj.rationale}</p>
                    )}
                  </div>
                )}

                {/* Summary markdown */}
                {obj.summary_markdown && (
                  <div className="text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:font-semibold [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mb-1 text-muted-foreground">
                    <Markdown>{obj.summary_markdown}</Markdown>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Version confirm dialog */}
      <Dialog open={versionConfirmOpen} onOpenChange={setVersionConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create version {brief.version_no + 1}?</DialogTitle>
            <DialogDescription>
              This will create an editable copy of this brief as v{brief.version_no + 1}. The current
              version (v{brief.version_no}) will remain locked and downloadable.
            </DialogDescription>
          </DialogHeader>
          {versionError && (
            <Alert variant="destructive">
              <AlertDescription>{versionError}</AlertDescription>
            </Alert>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setVersionConfirmOpen(false)} disabled={versionLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateVersion} disabled={versionLoading}>
              {versionLoading ? <><Loader2 className="mr-2 size-4 animate-spin" />Creating…</> : <>Create v{brief.version_no + 1} <ChevronRight className="ml-1 size-4" /></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
