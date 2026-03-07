import { useEffect, useRef, useCallback } from 'react';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import type { PlanningPage } from '@/types/planning';

const POLL_INTERVAL_MS = 3000;

// ── Page status indicator ─────────────────────────────────────────────────────

function PageStatusIcon({ status }: { status: PlanningPage['status'] }) {
  switch (status) {
    case 'complete':
      return <span className="text-green-500">✓</span>;
    case 'failed':
      return <span className="text-red-400">✗</span>;
    case 'scanning':
      return (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
      );
    default:
      return <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-200" />;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function Step3ScanningProgress() {
  const {
    currentSession,
    pages,
    setPages,
    updateSessionStatus,
    setStep,
    setError,
    error,
  } = usePlanningStore();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId = currentSession?.id;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { session, pages: freshPages } = await planningApi.getSession(sessionId);
      setPages(freshPages);
      updateSessionStatus(session.status, session.error_message);

      if (session.status === 'scan_complete' || session.status === 'outputs_ready') {
        stopPolling();
        setStep(4); // Advance to Review step
      } else if (session.status === 'failed') {
        stopPolling();
        setError(session.error_message ?? 'Scan failed');
      }
    } catch (err) {
      // Non-fatal — keep polling
      console.warn('Polling error:', err);
    }
  }, [sessionId, setPages, updateSessionStatus, setStep, setError, stopPolling]);

  useEffect(() => {
    if (!sessionId) return;

    // Immediate first poll
    poll();

    // Then poll on interval
    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return stopPolling;
  }, [sessionId, poll, stopPolling]);

  // ── Derived progress ────────────────────────────────────────────────────────

  const total = pages.length;
  const completed = pages.filter((p) => p.status === 'complete' || p.status === 'failed').length;
  const failed = pages.filter((p) => p.status === 'failed').length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const sessionStatus = currentSession?.status ?? 'scanning';
  const isDone = sessionStatus === 'scan_complete' || sessionStatus === 'outputs_ready';
  const isFailed = sessionStatus === 'failed';

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      {/* Heading */}
      <div className="mb-8 text-center">
        {isFailed ? (
          <>
            <div className="mb-3 text-4xl">⚠️</div>
            <h2 className="text-xl font-bold text-gray-900">Scan failed</h2>
            <p className="mt-1 text-sm text-gray-500">{error ?? 'An unexpected error occurred.'}</p>
          </>
        ) : isDone ? (
          <>
            <div className="mb-3 text-4xl">✅</div>
            <h2 className="text-xl font-bold text-gray-900">Scan complete!</h2>
            <p className="mt-1 text-sm text-gray-500">
              Analysed {completed - failed} page{completed - failed !== 1 ? 's' : ''} successfully.
              Taking you to the review screen…
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 inline-block h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
            <h2 className="mt-2 text-xl font-bold text-gray-900">Scanning your pages…</h2>
            <p className="mt-1 text-sm text-gray-500">
              Atlas is visiting each URL, capturing screenshots, and running AI analysis.
              This usually takes 30–90 seconds.
            </p>
          </>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-6">
          <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500">
            <span>
              {completed} of {total} page{total !== 1 ? 's' : ''} scanned
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
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

      {/* Per-page list */}
      {pages.length > 0 && (
        <div className="space-y-2">
          {pages
            .slice()
            .sort((a, b) => a.page_order - b.page_order)
            .map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-4 py-3"
              >
                <div className="flex-shrink-0">
                  <PageStatusIcon status={page.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {page.page_title ?? page.url}
                  </p>
                  {page.page_title && (
                    <p className="truncate text-xs text-gray-400">{page.url}</p>
                  )}
                </div>
                {page.status === 'failed' && page.error_message && (
                  <span
                    className="flex-shrink-0 cursor-help text-xs text-red-400"
                    title={page.error_message}
                  >
                    Error
                  </span>
                )}
                {page.status === 'complete' && page.page_type && (
                  <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs capitalize text-gray-500">
                    {page.page_type.replace('_', ' ')}
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      {/* Loading placeholder when pages haven't loaded yet */}
      {pages.length === 0 && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      )}
    </div>
  );
}
