import { useEffect, useState } from 'react';
import { Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { VerdictResultView } from './VerdictResultView';
import { campaignSignalValidatorApi } from '@/lib/api/campaignSignalValidatorApi';
import type { SignalValidatorRun } from '@/types/campaignSignalValidator';

/**
 * Campaign Signal Validator, embedded as a ClientDetailPage tab (B9). Runs
 * the pre-flight diagnostic against this client's site and shows the most
 * recent result, with past runs listed below.
 */
export function CampaignSignalValidatorTab({ clientId, websiteUrl }: { clientId: string; websiteUrl: string }) {
  const [runs, setRuns] = useState<SignalValidatorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await campaignSignalValidatorApi.listRuns(clientId);
      setRuns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleScan() {
    setScanning(true);
    setError(null);
    try {
      await campaignSignalValidatorApi.scan(websiteUrl, clientId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnostic failed');
    } finally {
      setScanning(false);
    }
  }

  async function handleDownloadPdf(runId: string) {
    const blob = await campaignSignalValidatorApi.downloadPdf(runId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-signal-validator-${runId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const latest = runs[0];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign Signal Validator</CardTitle>
          <CardDescription>
            Pre-flight check flagging weak or proxy primary conversion actions before automated
            bidding (e.g. Google AI Max) scales spend against them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleScan} disabled={scanning}>
            <Play className="mr-2 h-4 w-4" />
            {scanning ? 'Running…' : 'Run diagnostic'}
          </Button>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && latest?.status === 'completed' && latest.verdict && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => handleDownloadPdf(latest.id)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Download PDF
            </Button>
          </div>
          <VerdictResultView verdict={latest.verdict} />
        </div>
      )}

      {!loading && latest?.status === 'failed' && (
        <p className="text-sm text-destructive">Last run failed: {latest.error_message}</p>
      )}

      {!loading && runs.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Previous runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {runs.slice(1).map((run) => (
              <div key={run.id} className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{new Date(run.created_at).toLocaleString()}</span>
                <span>{run.verdict ? `${run.verdict.rating} (${run.verdict.score}/100)` : run.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
