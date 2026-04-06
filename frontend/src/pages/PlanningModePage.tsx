import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';
import { Step1PlanningSetup } from '@/components/planning/Step1PlanningSetup';
import { Step2PageDiscovery } from '@/components/planning/Step2PageDiscovery';
import { Step3ScanningProgress } from '@/components/planning/Step3ScanningProgress';
import { Step4ReviewRecommendations } from '@/components/planning/Step4ReviewRecommendations';
import { Step5TrackingPlanSummary } from '@/components/planning/Step5TrackingPlanSummary';
import { Step6ConsentStep } from '@/components/planning/Step6ConsentStep';
import { Step6GeneratedOutputs } from '@/components/planning/Step6GeneratedOutputs';
import { Step7DownloadAndHandoff } from '@/components/planning/Step7DownloadAndHandoff';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Step labels ────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Setup' },
  { n: 2, label: 'Pages' },
  { n: 3, label: 'Scan' },
  { n: 4, label: 'Review' },
  { n: 5, label: 'Summary' },
  { n: 6, label: 'Consent' },
  { n: 7, label: 'Outputs' },
  { n: 8, label: 'Handoff' },
];

const NAVY  = '#1B2A4A';
const GREEN = '#059669';

// ── Inline stepper (header bar) ────────────────────────────────────────────────

function WizardStepper({ currentStep }: { currentStep: number }) {
  return (
    <nav className="hidden items-center gap-0.5 md:flex" aria-label="Wizard steps">
      {STEPS.map(({ n, label }) => {
        const isDone    = n < currentStep;
        const isCurrent = n === currentStep;

        return (
          <div key={n} className="flex items-center gap-0.5">
            {/* Circle */}
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors shrink-0"
              style={{
                backgroundColor: isDone ? GREEN : isCurrent ? NAVY : '#F3F4F6',
                color: isDone || isCurrent ? '#fff' : '#9CA3AF',
              }}
            >
              {isDone ? <Check className="h-3 w-3" strokeWidth={2.5} /> : n}
            </div>

            {/* Label */}
            <span
              className={cn('text-xs', isCurrent ? 'font-semibold' : 'font-medium')}
              style={{ color: isCurrent ? NAVY : isDone ? '#6B7280' : '#9CA3AF' }}
            >
              {label}
            </span>

            {/* Connector */}
            {n < STEPS.length && (
              <div
                className="mx-1.5 h-px w-5 shrink-0 rounded-full transition-colors"
                style={{ backgroundColor: isDone ? GREEN : '#E5E7EB' }}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

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

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    if (currentSession?.id === sessionId) return;

    setLoading(true);
    setLoadError(null);
    planningApi
      .getSession(sessionId)
      .then(({ session, pages }) => {
        setCurrentSession(session);
        setPages(pages);

        switch (session.status) {
          case 'setup':
          case 'scanning':
            setStep(3);
            break;
          case 'review_ready':
            setStep(4);
            break;
          case 'generating':
            setStep(7);
            break;
          case 'outputs_ready':
            setStep(7);
            planningApi.getRecommendations(sessionId).then(({ recommendations }) => {
              setRecommendations(recommendations);
            }).catch(() => {});
            planningApi.listOutputs(sessionId).then(({ outputs }) => {
              setOutputs(outputs);
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

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (sessionId && isLoading && !currentSession) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F9FAFB]">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"
            style={{ borderColor: '#EEF1F7', borderTopColor: NAVY }}
          />
          <p className="text-sm text-[#6B7280]">Loading session…</p>
        </div>
      </div>
    );
  }

  // ── Error / not found ────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#F9FAFB] p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF2F2] border border-[#DC2626]/20">
          <X className="h-5 w-5 text-[#DC2626]" strokeWidth={1.5} />
        </div>
        <h2 className="text-section-header text-[#1A1A1A]">Session not found</h2>
        <p className="max-w-sm text-sm text-[#6B7280]">{loadError}</p>
        <Button
          variant="secondary"
          onClick={() => { reset(); navigate('/planning'); }}
        >
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#F9FAFB]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between border-b bg-white px-6"
        style={{ height: 64 }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#1A1A1A]">Atlas</span>
          <span className="text-[#D1D5DB]">/</span>
          <span className="text-sm font-medium text-[#6B7280]">Set Up Tracking</span>
        </div>

        {/* Step progress */}
        <WizardStepper currentStep={currentStep} />

        {/* Exit */}
        <button
          type="button"
          onClick={handleExit}
          className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#1A1A1A] transition-colors"
          aria-label="Exit wizard"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          Exit
        </button>
      </header>

      {/* ── Step content ──────────────────────────────────────────────────── */}
      <main className={`flex-1 ${currentStep >= 4 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {currentStep === 1 && <Step1PlanningSetup />}
        {currentStep === 2 && <Step2PageDiscovery />}
        {currentStep === 3 && <Step3ScanningProgress />}
        {currentStep === 4 && <Step4ReviewRecommendations />}
        {currentStep === 5 && <Step5TrackingPlanSummary />}
        {currentStep === 6 && <Step6ConsentStep />}
        {currentStep === 7 && <Step6GeneratedOutputs />}
        {currentStep === 8 && <Step7DownloadAndHandoff />}
      </main>
    </div>
  );
}
