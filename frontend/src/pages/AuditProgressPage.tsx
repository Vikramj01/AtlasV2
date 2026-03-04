import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuditStatus } from '@/hooks/useAudit';
import { AuditProgressSteps } from '@/components/audit/AuditProgressSteps';

function useElapsedTime(running: boolean) {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now();
    setSeconds(0);
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, string> = {
  queued:     'Queued — waiting to start…',
  running:    'Running — simulating real user journey…',
  completed:  'Completed',
  failed:     'Failed',
};

export function AuditProgressPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const [searchParams] = useSearchParams();
  const journeyId = searchParams.get('journeyId');
  const navigate = useNavigate();
  const { status, progress, error } = useAuditStatus(auditId);
  const [showLogs, setShowLogs] = useState(false);

  const isRunning = status !== 'completed' && status !== 'failed';
  const elapsed = useElapsedTime(isRunning);

  useEffect(() => {
    if (status === 'completed') {
      if (journeyId) {
        navigate(`/journey/${journeyId}/audit/${auditId}`, { replace: true });
      } else {
        navigate(`/report/${auditId}`, { replace: true });
      }
    }
  }, [status, auditId, journeyId, navigate]);

  const barWidth = Math.max(4, progress);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center gap-4">
          {/* Pulsing orb */}
          <div className="relative flex h-20 w-20 items-center justify-center">
            {isRunning && (
              <div className="absolute inset-0 animate-ping rounded-full bg-brand-100 opacity-75" />
            )}
            <div
              className={`relative h-14 w-14 rounded-full flex items-center justify-center transition-colors ${
                status === 'failed'
                  ? 'bg-red-500'
                  : status === 'completed'
                  ? 'bg-green-500'
                  : 'bg-brand-500'
              }`}
            >
              <span className="text-2xl text-white select-none">
                {status === 'failed' ? '✕' : status === 'completed' ? '✓' : '◈'}
              </span>
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">
              {STATUS_LABEL[status ?? 'queued'] ?? 'Initialising…'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              This usually takes 3–5 minutes. You can keep this tab open.
            </p>
          </div>
        </div>

        {/* Timer + progress percent row */}
        <div className="mb-2 flex items-center justify-between text-sm text-gray-500">
          <span className="font-mono tabular-nums">
            <span className="mr-1 text-gray-400">⏱</span>
            {elapsed}
          </span>
          <span className="font-medium text-gray-700">{progress}%</span>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-in-out ${
              status === 'failed' ? 'bg-red-500' : 'bg-brand-500'
            }`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        {/* Steps card */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Audit stages
          </p>
          <AuditProgressSteps progress={progress} />
        </div>

        {/* ETA hint */}
        {isRunning && progress > 0 && progress < 100 && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Estimated remaining:{' '}
            <span className="font-medium text-gray-500">
              {Math.max(0, Math.round((100 - progress) / 5))} min
            </span>
          </p>
        )}

        {/* Error state */}
        {status === 'failed' && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">Audit failed</p>
            <p className="mt-0.5 text-sm text-red-600">{error ?? 'An unexpected error occurred.'}</p>
            <button
              onClick={() => navigate('/journey/new')}
              className="mt-3 text-sm font-medium text-red-700 hover:underline"
            >
              ← Start a new audit
            </button>
          </div>
        )}

        {/* Technical logs toggle */}
        <div className="mt-6 text-center">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showLogs ? 'Hide' : 'View'} technical details
          </button>
          {showLogs && (
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left font-mono text-xs text-gray-500 space-y-0.5">
              <p>Audit ID: {auditId}</p>
              <p>Journey ID: {journeyId ?? '—'}</p>
              <p>Status: {status ?? 'initialising'}</p>
              <p>Progress: {progress}%</p>
              <p>Elapsed: {elapsed}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
