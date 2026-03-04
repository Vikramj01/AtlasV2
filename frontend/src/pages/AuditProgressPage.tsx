import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuditStatus } from '@/hooks/useAudit';
import { AuditProgressSteps } from '@/components/audit/AuditProgressSteps';

export function AuditProgressPage() {
  const { auditId } = useParams<{ auditId: string }>();
  const [searchParams] = useSearchParams();
  const journeyId = searchParams.get('journeyId');
  const navigate = useNavigate();
  const { status, progress, error } = useAuditStatus(auditId);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (status === 'completed') {
      // Journey-mode audit → Gap Report; legacy → old report
      if (journeyId) {
        navigate(`/journey/${journeyId}/audit/${auditId}`, { replace: true });
      } else {
        navigate(`/report/${auditId}`, { replace: true });
      }
    }
  }, [status, auditId, journeyId, navigate]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        {/* Animated indicator */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-brand-100 opacity-75" />
            <div className="relative h-14 w-14 rounded-full bg-brand-500 flex items-center justify-center">
              <span className="text-2xl text-white">◈</span>
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-gray-900">Simulating real user journey…</h1>
            <p className="mt-1 text-sm text-gray-500">This usually takes 3–5 minutes. You can keep this tab open.</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-brand-500 transition-all duration-500"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <AuditProgressSteps progress={progress} />
        </div>

        {/* Error state */}
        {status === 'failed' && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">Audit failed</p>
            <p className="mt-0.5 text-sm text-red-600">{error ?? 'An unexpected error occurred.'}</p>
            <button
              onClick={() => navigate('/dashboard')}
              className="mt-3 text-sm font-medium text-red-700 hover:underline"
            >
              ← Back to dashboard
            </button>
          </div>
        )}

        {/* Technical logs toggle */}
        <div className="mt-6 text-center">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            {showLogs ? 'Hide' : 'View'} technical logs
          </button>
          {showLogs && (
            <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left">
              <p className="font-mono text-xs text-gray-400">
                Audit ID: {auditId}<br />
                Status: {status ?? 'initializing'}<br />
                Progress: {progress}%
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
