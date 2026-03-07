import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { Step1PlanningSetup } from '@/components/planning/Step1PlanningSetup';
import { Step2PageDiscovery } from '@/components/planning/Step2PageDiscovery';
import { Step3ScanningProgress } from '@/components/planning/Step3ScanningProgress';
import { Step4ReviewRecommendations } from '@/components/planning/Step4ReviewRecommendations';
import { Step5TrackingPlanSummary } from '@/components/planning/Step5TrackingPlanSummary';
import { Step6GeneratedOutputs } from '@/components/planning/Step6GeneratedOutputs';
import { Step7DownloadAndHandoff } from '@/components/planning/Step7DownloadAndHandoff';

// ── Step labels for progress bar ───────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Setup' },
  { n: 2, label: 'Pages' },
  { n: 3, label: 'Scan' },
  { n: 4, label: 'Review' },
  { n: 5, label: 'Summary' },
  { n: 6, label: 'Outputs' },
  { n: 7, label: 'Handoff' },
];

// ── Wizard container ───────────────────────────────────────────────────────────

export function PlanningModePage() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();

  const {
    currentStep,
    currentSession,
    isLoading,
    setCurrentSession,
    setPages,
    setRecommendations,
    setOutputs,
    setStep,
    setLoading,
    setError,
    reset,
  } = usePlanningStore();

  // Local state for fatal load errors (404 / wrong user)
  const [loadError, setLoadError] = useState<string | null>(null);

  // When arriving at /planning/:sessionId, hydrate store from API
  useEffect(() => {
    if (!sessionId) return;
    if (currentSession?.id === sessionId) return; // already loaded

    setLoading(true);
    setLoadError(null);
    planningApi
      .getSession(sessionId)
      .then(({ session, pages }) => {
        setCurrentSession(session);
        setPages(pages);

        // Route to the appropriate step based on session status
        switch (session.status) {
          case 'pending':
          case 'scanning':
            setStep(3);
            break;
          case 'scan_complete':
            setStep(4);
            break;
          case 'generating':
            setStep(6);
            break;
          case 'outputs_ready':
            setStep(6);
            // Prefetch recommendations + outputs
            planningApi.getRecommendations(sessionId).then(({ recommendations }) => {
              setRecommendations(recommendations);
            }).catch(() => {});
            planningApi.listOutputs(sessionId).then(({ outputs }) => {
              setOutputs(outputs as Parameters<typeof setOutputs>[0]);
            }).catch(() => {});
            break;
          case 'failed':
            setStep(3);
            setError(session.error_message ?? 'Session failed');
            break;
        }
      })
      .catch((err: Error) => {
        const msg = err.message ?? '';
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          setLoadError('This planning session was not found or you don\'t have access to it.');
        } else {
          setLoadError(msg || 'Failed to load session.');
        }
      })
      .finally(() => setLoading(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExit() {
    reset();
    navigate('/planning');
  }

  // ── Loading overlay (initial hydration) ──────────────────────────────────

  if (sessionId && isLoading && !currentSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <p className="text-sm text-gray-500">Loading session…</p>
        </div>
      </div>
    );
  }

  // ── Not-found / access-denied error ──────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-lg font-bold text-gray-900">Session not found</h2>
        <p className="max-w-sm text-sm text-gray-500">{loadError}</p>
        <button
          onClick={() => { reset(); navigate('/planning'); }}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-900">Atlas</span>
          <span className="text-sm text-gray-400">/</span>
          <span className="text-sm font-medium text-gray-600">Planning Mode</span>
        </div>

        {/* Step progress */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Wizard steps">
          {STEPS.map(({ n, label }) => {
            const isDone = n < currentStep;
            const isCurrent = n === currentStep;
            return (
              <div key={n} className="flex items-center gap-1">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    isDone
                      ? 'bg-brand-600 text-white'
                      : isCurrent
                      ? 'bg-brand-100 text-brand-700 ring-2 ring-brand-500'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {isDone ? '✓' : n}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isCurrent ? 'text-brand-700' : isDone ? 'text-gray-500' : 'text-gray-300'
                  }`}
                >
                  {label}
                </span>
                {n < STEPS.length && (
                  <div
                    className={`mx-1 h-px w-6 ${isDone ? 'bg-brand-300' : 'bg-gray-200'}`}
                  />
                )}
              </div>
            );
          })}
        </nav>

        <button
          onClick={handleExit}
          className="text-sm text-gray-400 hover:text-gray-600"
          aria-label="Exit wizard"
        >
          ✕ Exit
        </button>
      </header>

      {/* Step content — steps 4–7 need full height for their layouts */}
      <main className={`flex-1 ${currentStep >= 4 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {currentStep === 1 && <Step1PlanningSetup />}
        {currentStep === 2 && <Step2PageDiscovery />}
        {currentStep === 3 && <Step3ScanningProgress />}
        {currentStep === 4 && <Step4ReviewRecommendations />}
        {currentStep === 5 && <Step5TrackingPlanSummary />}
        {currentStep === 6 && <Step6GeneratedOutputs />}
        {currentStep === 7 && <Step7DownloadAndHandoff />}
      </main>
    </div>
  );
}
