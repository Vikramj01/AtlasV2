import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCrawlStore } from '@/store/crawlStore';
import { CrawlProgress } from '@/components/crawl/CrawlProgress';
import { CrawlResults } from '@/components/crawl/CrawlResults';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tab = 'progress' | 'results';

export function CrawlStatusPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate   = useNavigate();
  const [tab, setTab] = useState<Tab>('progress');

  const { run, pages, error, setCurrentRun, startPolling, stopPolling, reset } = useCrawlStore();

  useEffect(() => {
    if (!runId) return;
    setCurrentRun(runId);
    startPolling();
    return () => stopPolling();
  }, [runId, setCurrentRun, startPolling, stopPolling]);

  // Auto-switch to results tab when scan completes
  useEffect(() => {
    if (run?.status === 'completed' || run?.status === 'partial') {
      setTab('results');
    }
  }, [run?.status]);

  const isTerminal = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'partial';

  function handleNewScan() {
    reset();
    navigate('/planning', { replace: true });
  }

  if (error && !run) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] p-6 text-center">
          <p className="text-sm font-semibold text-[#DC2626] mb-1">Failed to load scan</p>
          <p className="text-sm text-[#EF4444] mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>Go home</Button>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#1B2A4A] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[#1A1A1A]">Signal scan</h1>
            <p className="text-sm text-[#6B7280] mt-0.5 font-mono">{run.id}</p>
          </div>
          {isTerminal && (
            <Button variant="outline" size="sm" onClick={handleNewScan}>
              New scan
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-[#EEF1F7] p-1 w-fit">
          {(['progress', 'results'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-white text-[#1A1A1A] shadow-sm'
                  : 'text-[#6B7280] hover:text-[#1A1A1A]',
              )}
            >
              {t === 'progress' ? 'Progress' : 'Results'}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        {tab === 'progress' && <CrawlProgress run={run} pages={pages} />}
        {tab === 'results'  && <CrawlResults  run={run} pages={pages} />}

        {/* Error banner (non-fatal, run still loaded) */}
        {error && (
          <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#DC2626]">
            {error}
          </div>
        )}

        {/* Debug strip */}
        <details className="text-xs text-[#9CA3AF]">
          <summary className="cursor-pointer select-none hover:text-[#6B7280]">Technical details</summary>
          <div className="mt-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 font-mono space-y-0.5">
            <p>Run ID: {run.id}</p>
            <p>Status: {run.status}</p>
            <p>Mode: {run.mode}</p>
            <p>Pages: {run.pages_completed}/{run.total_pages}</p>
            {run.duration_seconds != null && <p>Duration: {run.duration_seconds}s</p>}
            {run.browserbase_session_id && <p>BB session: {run.browserbase_session_id}</p>}
          </div>
        </details>
      </div>
    </div>
  );
}
