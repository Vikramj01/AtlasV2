import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import type { Verification } from '@/types/tracking';

interface VerificationCardProps {
  clientId: string;
  siteUrl: string | null;
  verification: Verification;
  onVerificationStarted?: (runId: string) => void;
}

export function VerificationCard({ siteUrl, verification, onVerificationStarted }: VerificationCardProps) {
  const navigate = useNavigate();
  const [isTriggeringCrawl, setIsTriggeringCrawl] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);

  async function handleRunVerification() {
    if (!siteUrl) return;
    setIsTriggeringCrawl(true);
    setCrawlError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const apiBase = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${apiBase}/api/crawl/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ site_url: siteUrl, mode: 'onboarding', triggered_by: 'manual' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Failed to trigger scan');
      const runId = (body as { run_id?: string }).run_id;
      if (runId) {
        onVerificationStarted?.(runId);
        navigate(`/crawl/${runId}`);
      }
    } catch (err) {
      setCrawlError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setIsTriggeringCrawl(false);
    }
  }

  const { baseline, latest_crawl_run, ihc } = verification;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Verification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!baseline.set ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Once your developer has implemented the dataLayer and you've imported the GTM container,
              run a scan to confirm signals are firing.
            </p>
            <Button
              size="sm"
              className="w-full bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90 text-xs"
              disabled={isTriggeringCrawl || !siteUrl}
              onClick={handleRunVerification}
            >
              {isTriggeringCrawl ? 'Starting scan…' : 'Run verification scan'}
            </Button>
            {!siteUrl && (
              <p className="text-[10px] text-muted-foreground text-center">Add a website URL to enable verification.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <div>
                <p className="text-xs font-medium text-green-700">Verified</p>
                {baseline.set_at && (
                  <p className="text-[10px] text-muted-foreground">
                    Baseline set {new Date(baseline.set_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            {ihc && ihc.drift_count > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <p className="text-xs text-amber-700">
                  {ihc.drift_count} drift{ihc.drift_count !== 1 ? 's' : ''} detected
                </p>
                <Badge variant="outline" className="ml-auto text-[10px] border-amber-300 text-amber-700">
                  Review
                </Badge>
              </div>
            )}

            {latest_crawl_run && (
              <p className="text-[10px] text-muted-foreground">
                Last scan: {new Date(latest_crawl_run.completed_at).toLocaleDateString()} · {latest_crawl_run.signals_found} pages scanned
              </p>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                disabled={isTriggeringCrawl || !siteUrl}
                onClick={handleRunVerification}
              >
                {isTriggeringCrawl ? 'Starting…' : 'Re-scan'}
              </Button>
              {latest_crawl_run && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => navigate(`/crawl/${latest_crawl_run.run_id}`)}
                >
                  View scan
                </Button>
              )}
            </div>
          </div>
        )}

        {crawlError && <p className="text-xs text-red-600">{crawlError}</p>}
      </CardContent>
    </Card>
  );
}
