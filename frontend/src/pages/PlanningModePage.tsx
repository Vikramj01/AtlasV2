import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SECTION_LABELS } from '@/lib/ui-copy';
import { X } from 'lucide-react';
import { usePlanningStore } from '@/store/planningStore';
import { useShallow } from 'zustand/react/shallow';
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
import { WizardStepper } from '@/components/common/WizardStepper';

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
  } = usePlanningStore(useShallow((s) => ({
    currentStep: s.currentStep,
    currentSession: s.currentSession,
    isLoading: s.isLoading,
    setCurrentSession: s.setCurrentSession,
    setPages: s.setPages,
    setRecommendations: s.setRecommendations,
    setOutputs: s.setOutputs,
    setStep: s.setStep,
    setLoading: s.setLoading,
    setError: s.setError,
    reset: s.reset,
  })));

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
      <div className="flex h-screen items-center justify-center bg-console-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-console-primary/15 border-t-console-primary" />
          <p className="text-sm text-console-fg-subtle">Loading session…</p>
        </div>
      </div>
    );
  }

  // ── Error / not found ────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-console-bg p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-console-red/10 border border-console-red/20">
          <X className="h-5 w-5 text-console-red" strokeWidth={1.5} />
        </div>
        <h2 className="text-section-header text-console-fg">Session not found</h2>
        <p className="max-w-sm text-sm text-console-fg-subtle">{loadError}</p>
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
    <div className="flex h-screen flex-col bg-console-bg">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between border-b border-console-border bg-console-surface px-6"
        style={{ height: 64 }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <span className="font-display text-sm text-console-fg">Atlas</span>
          <span className="text-console-fg-disabled">/</span>
          <span className="text-sm font-medium text-console-fg-subtle">
            {SECTION_LABELS.planningMode.primary}
            <span className="ml-1 font-mono text-[10px] opacity-60">{SECTION_LABELS.planningMode.technical}</span>
          </span>
        </div>

        {/* Step progress */}
        <WizardStepper steps={STEPS} currentStep={currentStep} />

        {/* Exit */}
        <button
          type="button"
          onClick={handleExit}
          className="flex items-center gap-1.5 text-xs text-console-fg-subtle hover:text-console-fg transition-colors"
          aria-label="Exit wizard"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          Exit
        </button>
      </header>

      {/* ── Step content ──────────────────────────────────────────────────── */}
      <main className={`flex-1 ${currentStep === 4 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
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
