import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Trash2, Check, X } from 'lucide-react';
import { planningApi } from '@/lib/api/planningApi';
import { usePlanningStore } from '@/store/planningStore';
import type { PlanningSession, ImplementationProgress, ChangeDetectionResult } from '@/types/planning';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProgressBar } from '@/components/developer/ProgressBar';
import { ChangeDetectionResults } from '@/components/planning/ChangeDetectionResults';

const STATUS_LABELS: Record<PlanningSession['status'], string> = {
  setup:         'Setup',
  scanning:      'Scanning…',
  review_ready:  'Ready to Review',
  generating:    'Generating…',
  outputs_ready: 'Ready',
  failed:        'Failed',
};

const STATUS_COLORS: Record<PlanningSession['status'], string> = {
  setup:         'bg-gray-100 text-gray-600 hover:bg-gray-100',
  scanning:      'bg-blue-100 text-blue-700 hover:bg-blue-100',
  review_ready:  'bg-yellow-100 text-yellow-700 hover:bg-yellow-100',
  generating:    'bg-blue-100 text-blue-700 hover:bg-blue-100',
  outputs_ready: 'bg-green-100 text-green-700 hover:bg-green-100',
  failed:        'bg-red-100 text-red-700 hover:bg-red-100',
};

// ── Implementation progress cell ──────────────────────────────────────────────

function ImplementationCell({
  progress,
  status,
}: {
  progress: ImplementationProgress | null | undefined;
  status: PlanningSession['status'];
}) {
  if (status !== 'outputs_ready') {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }
  if (progress === undefined) {
    return <span className="text-xs text-muted-foreground/50">Loading…</span>;
  }
  if (!progress) {
    return <span className="text-xs text-muted-foreground/50">Not shared yet</span>;
  }
  return (
    <div className="min-w-[120px]">
      <p className="mb-1 text-xs text-muted-foreground">
        {progress.implemented + progress.verified}/{progress.total_pages} pages
      </p>
      <ProgressBar value={progress.percent_complete} />
    </div>
  );
}

// ── Re-scan button cell ───────────────────────────────────────────────────────

function RescanCell({
  session,
  rescanResults,
  isRescanning,
  onRescan,
  onViewResults,
}: {
  session: PlanningSession;
  rescanResults: ChangeDetectionResult | null | undefined;
  isRescanning: boolean;
  onRescan: (sessionId: string) => void;
  onViewResults: (sessionId: string) => void;
}) {
  if (session.status !== 'outputs_ready' && session.status !== 'review_ready') {
    return <span className="text-xs text-muted-foreground/50">—</span>;
  }

  const hasResults = rescanResults?.status === 'complete';
  const isScanning = isRescanning || rescanResults?.status === 'scanning';

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isScanning}
        onClick={() => onRescan(session.id)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Re-scan pages and detect changes"
      >
        {isScanning ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            Scanning…
          </span>
        ) : (
          '↺ Re-scan'
        )}
      </button>
      {hasResults && (
        <button
          type="button"
          onClick={() => onViewResults(session.id)}
          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
        >
          {rescanResults?.summary?.action_required ? '⚠ View changes' : '✓ View results'}
        </button>
      )}
      {session.last_rescan_at && hasResults && (
        <span className="text-xs text-muted-foreground/50">
          {new Date(session.last_rescan_at).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PlanningDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const reset = usePlanningStore((s) => s.reset);
  const [sessions, setSessions] = useState<PlanningSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, ImplementationProgress | null>>({});
  const [rescanMap, setRescanMap] = useState<Record<string, ChangeDetectionResult | null>>({});
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const limitReached = (location.state as { limitReached?: boolean } | null)?.limitReached ?? false;
  const limitMessage = (location.state as { limitMessage?: string } | null)?.limitMessage ?? '';

  useEffect(() => {
    planningApi
      .listSessions()
      .then(({ sessions: list }) => {
        setSessions(list);
        // Fire-and-forget: fetch progress for completed sessions that may have shares
        const readySessions = list.filter((s) => s.status === 'outputs_ready');
        for (const s of readySessions) {
          planningApi.getProgress(s.id)
            .then(({ progress }) => {
              setProgressMap((prev) => ({ ...prev, [s.id]: progress }));
            })
            .catch(() => {});

          // Restore any existing rescan results from session data
          if (s.rescan_results) {
            setRescanMap((prev) => ({ ...prev, [s.id]: s.rescan_results }));
          }
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));

    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNew() {
    reset();
    navigate('/planning/new');
  }

  function handleOpen(session: PlanningSession) {
    reset();
    navigate(`/planning/${session.id}`);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setConfirmId(null);
    try {
      await planningApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // keep the row if delete fails
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRescan(sessionId: string) {
    setRescanningId(sessionId);
    try {
      await planningApi.startRescan(sessionId);
      // Start polling for results
      const timer = setInterval(async () => {
        const { rescan_results } = await planningApi.getChanges(sessionId);
        if (rescan_results?.status === 'complete' || rescan_results?.status === 'failed') {
          clearInterval(timer);
          setPollTimer(null);
          setRescanningId(null);
          setRescanMap((prev) => ({ ...prev, [sessionId]: rescan_results }));
          // Update the session's last_rescan_at from the result
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? { ...s, last_rescan_at: rescan_results.completed_at, rescan_results }
                : s,
            ),
          );
        }
      }, 5000);
      setPollTimer(timer);
    } catch {
      setRescanningId(null);
    }
  }

  function handleViewResults(sessionId: string) {
    setViewingResultsId(sessionId);
  }

  const viewingSession = viewingResultsId ? sessions.find((s) => s.id === viewingResultsId) : null;
  const viewingResults = viewingResultsId ? rescanMap[viewingResultsId] : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* Change detection results modal */}
      {viewingResultsId && viewingResults?.status === 'complete' && viewingSession && (
        <ChangeDetectionResults
          sessionId={viewingResultsId}
          results={viewingResults}
          onClose={() => setViewingResultsId(null)}
        />
      )}

      {/* Plan-limit upgrade banner */}
      {limitReached && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
          <span className="mt-0.5 text-lg">🔒</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Plan limit reached</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {limitMessage || "You've used all planning sessions included in your current plan."}
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Upgrade to <strong>Pro</strong> for 10 sessions/month, or <strong>Agency</strong> for unlimited.
            </p>
          </div>
          <Button asChild size="sm" className="flex-shrink-0 bg-amber-600 hover:bg-amber-700">
            <Link to="/settings">Upgrade plan</Link>
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Planning Mode</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan your website and get a ready-to-import GTM container with AI-recommended tracking.
          </p>
        </div>
        <Button onClick={handleNew} className="bg-brand-600 hover:bg-brand-700">
          + New Plan
        </Button>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          Loading sessions…
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
          <div className="mb-3 text-4xl text-muted-foreground/40">◎</div>
          <p className="text-sm font-medium text-muted-foreground">No planning sessions yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create your first plan to generate a GTM container and implementation guide.
          </p>
          <Button onClick={handleNew} className="mt-5 bg-brand-600 hover:bg-brand-700">
            Get Started
          </Button>
        </div>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Website</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Implementation</TableHead>
                <TableHead>Re-scan</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id} className={deletingId === s.id ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{s.website_url}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {s.business_type.replace('_', ' ')}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[s.status]}>
                      {STATUS_LABELS[s.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ImplementationCell progress={progressMap[s.id]} status={s.status} />
                  </TableCell>
                  <TableCell>
                    <RescanCell
                      session={s}
                      rescanResults={rescanMap[s.id] ?? s.rescan_results}
                      isRescanning={rescanningId === s.id}
                      onRescan={handleRescan}
                      onViewResults={handleViewResults}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleOpen(s)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Open →
                      </button>
                      {confirmId === s.id ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>Delete?</span>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="rounded p-0.5 text-red-600 hover:bg-red-50"
                            title="Confirm delete"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmId(s.id)}
                          disabled={deletingId === s.id}
                          className="rounded p-1 text-muted-foreground/50 hover:bg-red-50 hover:text-red-500 transition-colors"
                          title="Delete session"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
