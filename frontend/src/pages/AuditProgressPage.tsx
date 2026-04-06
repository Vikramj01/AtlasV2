import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuditStatus } from '@/hooks/useAudit';
import { AuditProgressSteps } from '@/components/audit/AuditProgressSteps';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const NAVY = '#1B2A4A';

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
  queued:    'Queued — waiting to start…',
  running:   'Running — simulating real user journey…',
  completed: 'Completed',
  failed:    'Failed',
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
    <div className="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center gap-4">
          {/* Pulsing orb */}
          <div className="relative flex h-20 w-20 items-center justify-center">
            {isRunning && (
              <div
                className="absolute inset-0 animate-ping rounded-full opacity-40"
                style={{ backgroundColor: '#EEF1F7' }}
              />
            )}
            <div
              className="relative h-14 w-14 rounded-full flex items-center justify-center transition-colors"
              style={{
                backgroundColor:
                  status === 'failed'   ? '#DC2626' :
                  status === 'completed' ? '#059669' :
                  NAVY,
              }}
            >
              <span className="text-2xl text-white select-none">
                {status === 'failed' ? '✕' : status === 'completed' ? '✓' : '◈'}
              </span>
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-page-title">
              {STATUS_LABEL[status ?? 'queued'] ?? 'Initialising…'}
            </h1>
            <p className="mt-1 text-body text-[#6B7280]">
              This usually takes 3–5 minutes. You can keep this tab open.
            </p>
          </div>
        </div>

        {/* Timer + progress percent row */}
        <div className="mb-2 flex items-center justify-between text-sm text-[#6B7280]">
          <span className="font-mono tabular-nums text-[#9CA3AF]">
            ⏱ {elapsed}
          </span>
          <span className="font-semibold text-[#1A1A1A]">{progress}%</span>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-[#EEF1F7]">
          <div
            className={cn('h-full rounded-full transition-all duration-700 ease-in-out')}
            style={{
              width: `${barWidth}%`,
              backgroundColor: status === 'failed' ? '#DC2626' : NAVY,
            }}
          />
        </div>

        {/* Steps card */}
        <Card>
          <CardContent className="pt-6">
            <p className="mb-4 text-caption-upper">Audit stages</p>
            <AuditProgressSteps progress={progress} />
          </CardContent>
        </Card>

        {/* ETA hint */}
        {isRunning && progress > 0 && progress < 100 && (
          <p className="mt-4 text-center text-xs text-[#9CA3AF]">
            Estimated remaining:{' '}
            <span className="font-medium text-[#6B7280]">
              {Math.max(0, Math.round((100 - progress) / 5))} min
            </span>
          </p>
        )}

        {/* Error state */}
        {status === 'failed' && (
          <div className="mt-4 rounded-lg border border-[#DC2626]/20 bg-[#FEF2F2] p-4">
            <p className="text-sm font-semibold text-[#DC2626]">Audit failed</p>
            <p className="mt-0.5 text-sm text-[#DC2626]/80">{error ?? 'An unexpected error occurred.'}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/journey/new')}
              className="mt-2 h-auto p-0 text-[#DC2626] hover:text-[#DC2626]/80"
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
            className="text-xs text-[#9CA3AF] hover:text-[#6B7280] h-auto py-1"
          >
            {showLogs ? 'Hide' : 'View'} technical details
          </Button>
          {showLogs && (
            <div className="mt-3 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-left font-mono text-xs text-[#6B7280] space-y-0.5">
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
