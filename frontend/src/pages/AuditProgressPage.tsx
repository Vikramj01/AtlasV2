import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuditStatus } from '@/hooks/useAudit';
import { AuditProgressSteps } from '@/components/audit/AuditProgressSteps';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center gap-4">
          {/* Pulsing orb */}
          <div className="relative flex h-20 w-20 items-center justify-center">
            {isRunning && (
              <div className="absolute inset-0 animate-ping rounded-full bg-brand-100 opacity-75" />
            )}
            <div
              className={cn(
                'relative h-14 w-14 rounded-full flex items-center justify-center transition-colors',
                status === 'failed'
                  ? 'bg-destructive'
                  : status === 'completed'
                  ? 'bg-green-500'
                  : 'bg-brand-500'
              )}
            >
              <span className="text-2xl text-white select-none">
                {status === 'failed' ? '✕' : status === 'completed' ? '✓' : '◈'}
              </span>
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">
              {STATUS_LABEL[status ?? 'queued'] ?? 'Initialising…'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This usually takes 3–5 minutes. You can keep this tab open.
            </p>
          </div>
        </div>

        {/* Timer + progress percent row */}
        <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">
            <span className="mr-1 text-muted-foreground/60">⏱</span>
            {elapsed}
          </span>
          <span className="font-medium text-foreground">{progress}%</span>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700 ease-in-out',
              status === 'failed' ? 'bg-destructive' : 'bg-brand-500'
            )}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        {/* Steps card */}
        <Card>
          <CardContent className="pt-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Audit stages
            </p>
            <AuditProgressSteps progress={progress} />
          </CardContent>
        </Card>

        {/* ETA hint */}
        {isRunning && progress > 0 && progress < 100 && (
          <p className="mt-4 text-center text-xs text-muted-foreground/60">
            Estimated remaining:{' '}
            <span className="font-medium text-muted-foreground">
              {Math.max(0, Math.round((100 - progress) / 5))} min
            </span>
          </p>
        )}

        {/* Error state */}
        {status === 'failed' && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">Audit failed</p>
            <p className="mt-0.5 text-sm text-destructive/80">{error ?? 'An unexpected error occurred.'}</p>
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate('/journey/new')}
              className="mt-2 h-auto p-0 text-destructive hover:text-destructive/80"
            >
              ← Start a new audit
            </Button>
          </div>
        )}

        {/* Technical logs toggle */}
        <div className="mt-6 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground h-auto py-1"
          >
            {showLogs ? 'Hide' : 'View'} technical details
          </Button>
          {showLogs && (
            <div className="mt-3 rounded-lg border bg-muted p-3 text-left font-mono text-xs text-muted-foreground space-y-0.5">
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
