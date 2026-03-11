import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { PlanningPage } from '@/types/planning';

const POLL_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 5;

function PageStatusIcon({ status }: { status: PlanningPage['status'] }) {
  switch (status) {
    case 'done':
      return <span className="text-green-500">✓</span>;
    case 'failed':
      return <span className="text-red-400">✗</span>;
    case 'scanning':
      return (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
      );
    default:
      return <span className="inline-block h-4 w-4 rounded-full border-2 border-border" />;
  }
}

export function Step3ScanningProgress() {
  const navigate = useNavigate();
  const { currentSession, pages, setPages, updateSessionStatus, setStep, setError, reset, error } = usePlanningStore();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const sessionId = currentSession?.id;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { session, pages: freshPages } = await planningApi.getSession(sessionId);
      consecutiveFailuresRef.current = 0;

      setPages(freshPages);
      updateSessionStatus(session.status, session.error_message);

      if (session.status === 'review_ready' || session.status === 'outputs_ready') {
        stopPolling();
        setStep(4);
      } else if (session.status === 'failed') {
        stopPolling();
        setError(session.error_message ?? 'Scan failed');
      }
    } catch (err) {
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        stopPolling();
        setError('Lost connection to the server. Please check your network and refresh.');
      } else {
        console.warn(`Polling error (${consecutiveFailuresRef.current}/${MAX_CONSECUTIVE_FAILURES}):`, err);
      }
    }
  }, [sessionId, setPages, updateSessionStatus, setStep, setError, stopPolling]);

  useEffect(() => {
    if (!sessionId) return;
    poll();
    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return stopPolling;
  }, [sessionId, poll, stopPolling]);

  const total = pages.length;
  const completed = pages.filter((p) => p.status === 'done' || p.status === 'failed').length;
  const failed = pages.filter((p) => p.status === 'failed').length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const sessionStatus = currentSession?.status ?? 'scanning';
  const isDone = sessionStatus === 'review_ready' || sessionStatus === 'outputs_ready';
  const isFailed = sessionStatus === 'failed';

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <div className="mb-8 text-center">
        {isFailed ? (
          <>
            <div className="mb-3 text-4xl">⚠️</div>
            <h2 className="text-xl font-bold">Scan failed</h2>
            <p className="mt-1 text-sm text-muted-foreground">{error ?? 'An unexpected error occurred.'}</p>
            <div className="mt-4 flex justify-center gap-3">
              <Button onClick={() => { reset(); navigate('/planning/new'); }} className="bg-brand-600 hover:bg-brand-700">
                Try again with a new session
              </Button>
              <Button variant="outline" onClick={() => { reset(); navigate('/planning'); }}>
                Back to Dashboard
              </Button>
            </div>
          </>
        ) : isDone ? (
          <>
            <div className="mb-3 text-4xl">✅</div>
            <h2 className="text-xl font-bold">Scan complete!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Analysed {completed - failed} page{completed - failed !== 1 ? 's' : ''} successfully.
              Taking you to the review screen…
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 inline-block h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <h2 className="mt-2 text-xl font-bold">Scanning your pages…</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Atlas is visiting each URL, capturing screenshots, and running AI analysis.
              This usually takes 30–90 seconds.
            </p>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="mb-6">
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>{completed} of {total} page{total !== 1 ? 's' : ''} scanned</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {failed > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              {failed} page{failed !== 1 ? 's' : ''} could not be scanned (will be skipped)
            </p>
          )}
        </div>
      )}

      {pages.length > 0 && (
        <div className="space-y-2">
          {pages
            .slice()
            .sort((a, b) => a.page_order - b.page_order)
            .map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3"
              >
                <div className="flex-shrink-0">
                  <PageStatusIcon status={page.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{page.page_title ?? page.url}</p>
                  {page.page_title && (
                    <p className="truncate text-xs text-muted-foreground">{page.url}</p>
                  )}
                </div>
                {page.status === 'failed' && page.error_message && (
                  <span className="flex-shrink-0 cursor-help text-xs text-destructive" title={page.error_message}>
                    Error
                  </span>
                )}
                {page.status === 'done' && page.page_type && (
                  <span className="flex-shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
                    {page.page_type.replace('_', ' ')}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      {pages.length === 0 && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}
    </div>
  );
}
