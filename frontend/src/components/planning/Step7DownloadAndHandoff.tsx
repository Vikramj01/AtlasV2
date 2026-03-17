import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { WalkerOSAdvantageCard } from '@/components/signals/WalkerOSAdvantageCard';
import type { OutputType } from '@/types/planning';

// ── Share with Developer modal/inline reveal ──────────────────────────────────

function ShareReveal({
  shareUrl,
  onClose,
}: {
  shareUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-800">Share link generated</p>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <p className="mb-3 text-xs text-brand-700">
        Send this link to your developer. They can open it without an Atlas account.
        The link expires in 90 days.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={shareUrl}
          className="flex-1 rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-mono text-foreground select-all"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0 text-xs">
          {copied ? '✓ Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

const OUTPUT_LABELS: Record<OutputType, string> = {
  gtm_container:        'GTM Container JSON',
  datalayer_spec:       'DataLayer Specification',
  implementation_guide: 'Implementation Guide (HTML)',
};

const OUTPUT_EXT: Record<OutputType, string> = {
  gtm_container:        'json',
  datalayer_spec:       'json',
  implementation_guide: 'html',
};

export function Step7DownloadAndHandoff() {
  const navigate = useNavigate();
  const { currentSession, outputs, reset } = usePlanningStore();

  const sessionId = currentSession?.id ?? '';
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [developerEmail, setDeveloperEmail] = useState('');
  const [developerName, setDeveloperName] = useState('');
  const [inviteEmailSentTo, setInviteEmailSentTo] = useState<string | null>(null);

  async function handleShare() {
    setIsSharing(true);
    setShareError(null);
    try {
      const result = await planningApi.createShare(sessionId, {
        developer_email: developerEmail.trim() || undefined,
        developer_name: developerName.trim() || undefined,
      });
      setShareUrl(result.share_url);
      if (developerEmail.trim()) setInviteEmailSentTo(developerEmail.trim());
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to create share link');
    } finally {
      setIsSharing(false);
    }
  }

  async function handleStartAudit() {
    setIsHandingOff(true);
    setHandoffError(null);
    try {
      const { journey_id } = await planningApi.handoff(sessionId);
      reset();
      navigate(`/journey/${journey_id}/spec`);
    } catch (err) {
      setHandoffError(err instanceof Error ? err.message : 'Handoff failed');
    } finally {
      setIsHandingOff(false);
    }
  }

  async function handleDownload(outputId: string, outputType: OutputType, downloadUrl?: string) {
    try {
      let blob: Blob;
      if (downloadUrl) {
        const res = await fetch(downloadUrl);
        blob = await res.blob();
      } else {
        blob = await planningApi.downloadOutput(sessionId, outputId);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-${outputType}.${OUTPUT_EXT[outputType]}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }

  function handleReturnToDashboard() {
    reset();
    navigate('/planning');
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-10 text-center">
        <div className="mb-4 text-5xl">🚀</div>
        <h2 className="text-2xl font-bold">Your tracking plan is ready!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Share the files below with your developer. Once tracking is live, come back to verify it
          with Atlas Audit Mode.
        </p>
      </div>

      {outputs.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Download your files
            </h3>
          </CardHeader>
          <CardContent className="space-y-2">
            {outputs.map((output) => (
              <div
                key={output.id}
                className="flex items-center justify-between rounded-lg bg-muted px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{OUTPUT_LABELS[output.output_type]}</p>
                  {output.file_size_bytes && (
                    <p className="text-xs text-muted-foreground">
                      {output.file_size_bytes > 1024
                        ? `${(output.file_size_bytes / 1024).toFixed(1)} KB`
                        : `${output.file_size_bytes} B`}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(output.id, output.output_type, output.download_url)}
                  className="text-xs"
                >
                  ↓ Download
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <WalkerOSAdvantageCard context="output" />
      </div>

      {/* Share with Developer */}
      <div className="mb-8">
        {shareUrl ? (
          <div className="space-y-3">
            <ShareReveal shareUrl={shareUrl} onClose={() => setShareUrl(null)} />
            {inviteEmailSentTo && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-2.5">
                ✓ Invite email sent to <strong>{inviteEmailSentTo}</strong>
              </p>
            )}
          </div>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Share with your developer
              </h3>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <p className="text-xs text-muted-foreground">
                Generate a link so your developer can see exactly what to implement, page by page.
                No Atlas account required. Optionally add their email to send the link directly.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="dev-email" className="text-xs">Developer email <span className="text-muted-foreground/60">(optional)</span></Label>
                  <Input
                    id="dev-email"
                    type="email"
                    placeholder="developer@agency.com"
                    value={developerEmail}
                    onChange={(e) => setDeveloperEmail(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dev-name" className="text-xs">Developer name <span className="text-muted-foreground/60">(optional)</span></Label>
                  <Input
                    id="dev-name"
                    type="text"
                    placeholder="Alex"
                    value={developerName}
                    onChange={(e) => setDeveloperName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              {shareError && <p className="text-xs text-destructive">{shareError}</p>}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleShare}
                  disabled={isSharing || !sessionId}
                  className="text-xs"
                >
                  {isSharing ? 'Generating…' : '🔗 Generate share link'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mb-8">
        <CardHeader className="pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What happens next?
          </h3>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {[
              { step: '1', title: 'Hand off to your developer', body: 'Share the Implementation Guide and DataLayer Spec with your dev team.' },
              { step: '2', title: 'Import the GTM container', body: 'Your developer or GTM admin imports the JSON file and fills in your platform IDs.' },
              { step: '3', title: 'Test in GTM Preview Mode', body: 'Use Tag Assistant to verify every event fires on the right page.' },
              { step: '4', title: 'Verify with Atlas Audit Mode', body: 'Come back here to run an automated audit that validates every signal end-to-end.' },
            ].map(({ step, title, body }) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                  {step}
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {handoffError && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {handoffError}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Button
          onClick={handleStartAudit}
          disabled={isHandingOff}
          className="w-full bg-brand-600 hover:bg-brand-700 py-3"
        >
          {isHandingOff ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating audit journey…
            </span>
          ) : (
            '🔍 Set Up Audit Mode →'
          )}
        </Button>

        <Button variant="outline" onClick={handleReturnToDashboard} className="w-full py-3">
          Return to Dashboard
        </Button>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        The Audit Mode journey has been pre-populated from your approved recommendations.
        You can review and adjust it before running the first audit.
      </p>
    </div>
  );
}
