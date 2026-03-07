import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { Step1PlanningSetup } from '@/components/planning/Step1PlanningSetup';
import { Step2PageDiscovery } from '@/components/planning/Step2PageDiscovery';
import { Step3ScanningProgress } from '@/components/planning/Step3ScanningProgress';

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
    setCurrentSession,
    setPages,
    setRecommendations,
    setOutputs,
    setStep,
    setLoading,
    setError,
    reset,
  } = usePlanningStore();

  // When arriving at /planning/:sessionId, hydrate store from API
  useEffect(() => {
    if (!sessionId) return;
    if (currentSession?.id === sessionId) return; // already loaded

    setLoading(true);
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
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExit() {
    reset();
    navigate('/planning');
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

      {/* Step content */}
      <main className="flex-1 overflow-y-auto">
        {currentStep === 1 && <Step1PlanningSetup />}
        {currentStep === 2 && <Step2PageDiscovery />}
        {currentStep === 3 && <Step3ScanningProgress />}
        {currentStep === 4 && (
          <PlaceholderStep step={4} label="Review AI Recommendations" note="Coming in PM-5" />
        )}
        {currentStep === 5 && (
          <PlaceholderStep step={5} label="Tracking Plan Summary" note="Coming in PM-5" />
        )}
        {currentStep === 6 && (
          <PlaceholderStep step={6} label="Generated Outputs" note="Coming in PM-5" />
        )}
        {currentStep === 7 && (
          <PlaceholderStep step={7} label="Download & Handoff" note="Coming in PM-5" />
        )}
      </main>
    </div>
  );
}

// ── Temporary placeholder for steps 4–7 (implemented in PM-5) ────────────────

function PlaceholderStep({ step, label, note }: { step: number; label: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-2 text-3xl font-bold text-gray-200">Step {step}</div>
      <div className="text-lg font-medium text-gray-700">{label}</div>
      <div className="mt-1 text-sm text-gray-400">{note}</div>
    </div>
  );
}
