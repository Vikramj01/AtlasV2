import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { OutputType } from '@/types/planning';

// ── Share with Developer modal/inline reveal ──────────────────────────────────

/**
 * ShareReveal — shown after the share link is generated.
 *
 * Auto-copies the URL to clipboard on mount (one-click handoff).
 * User sees the confirmation immediately with the URL below for manual copy.
 */
function ShareReveal({
  shareUrl,
  onClose,
}: {
  shareUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Auto-copy on mount
  useEffect(() => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
    }).catch(() => {
      // clipboard not available — degrade gracefully
    });
  }, [shareUrl]);

  function handleManualCopy() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div
      className="rounded-lg border px-4 py-4 space-y-3"
      style={{ backgroundColor: '#EEF1F7', borderColor: `#1B2A4A20` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
            style={{ backgroundColor: copied ? '#059669' : '#1B2A4A', color: '#fff' }}
          >
            {copied ? '✓' : '🔗'}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>
              {copied ? 'Link copied to clipboard!' : 'Share link generated'}
            </p>
            <p className="text-xs text-[#6B7280]">
              Send this to your developer — no Atlas account needed. Expires in 90 days.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#9CA3AF] hover:text-[#1A1A1A] transition-colors text-lg leading-none shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <div className="flex gap-2">
        <input
          readOnly
          value={shareUrl}
          className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-mono text-[#1A1A1A] select-all"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleManualCopy}
          className="shrink-0 text-xs"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

const OUTPUT_LABELS: Record<OutputType, string> = {
  gtm_container:        'GTM Container JSON',
  datalayer_spec:       'DataLayer Specification',
  implementation_guide: 'Developer Handoff Doc',
};

const OUTPUT_EXT: Record<OutputType, string> = {
  gtm_container:        'json',
  datalayer_spec:       'json',
  implementation_guide: 'md',
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
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#EEF1F7] text-xs font-bold text-[#1B2A4A]">
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
          className="w-full py-3"
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
