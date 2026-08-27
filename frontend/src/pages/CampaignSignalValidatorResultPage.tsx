import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerdictResultView } from '@/components/campaignSignalValidator/VerdictResultView';
import { campaignSignalValidatorApi } from '@/lib/api/campaignSignalValidatorApi';
import type { SignalValidatorPurchaseStatus } from '@/types/campaignSignalValidator';

/**
 * Standalone paid product result page (B9). Stripe redirects here after
 * checkout with {CHECKOUT_SESSION_ID} in the URL — this page polls purchase
 * status until the webhook has fulfilled the purchase and the diagnostic run
 * completes, then shows the report + PDF download.
 */
export function CampaignSignalValidatorResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [purchase, setPurchase] = useState<SignalValidatorPurchaseStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId) { setNotFound(true); return; }

    async function poll() {
      try {
        const { data } = await campaignSignalValidatorApi.getPurchaseStatus(sessionId!);
        setPurchase(data);
        if (data.status === 'paid' && data.run?.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        setNotFound(true);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <p className="text-muted-foreground">We couldn't find that purchase.</p>
        <Link to="/tools/campaign-signal-validator" className="mt-4 inline-block text-primary underline">
          Back to Campaign Signal Validator
        </Link>
      </div>
    );
  }

  const isReady = purchase?.status === 'paid' && purchase.run?.status === 'completed' && purchase.run.verdict;
  const isFailed = purchase?.status === 'paid' && purchase.run?.status === 'failed';

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Your Campaign Signal Validator report</h1>

      {!isReady && !isFailed && (
        <div className="mt-10 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p>
            {purchase?.status === 'pending'
              ? 'Confirming your payment…'
              : 'Running your diagnostic — this usually takes a few seconds.'}
          </p>
        </div>
      )}

      {isFailed && (
        <p className="mt-10 text-destructive">
          The diagnostic run failed. Contact support and reference session {sessionId}.
        </p>
      )}

      {isReady && purchase?.run?.verdict && (
        <div className="mt-6 space-y-4">
          {purchase.pdf_url && (
            <div className="flex justify-end">
              <a href={purchase.pdf_url} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Download PDF
                </Button>
              </a>
            </div>
          )}
          <VerdictResultView verdict={purchase.run.verdict} url={purchase.run.url} />
        </div>
      )}
    </div>
  );
}
