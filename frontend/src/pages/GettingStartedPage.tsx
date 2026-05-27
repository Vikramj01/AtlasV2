import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { useOnboardingStore } from '@/store/onboardingStore';
import { SkeletonCard } from '@/components/common/SkeletonCard';

function GettingStartedContent() {
  const { status, isLoading, fetchStatus } = useOnboardingStore();

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Dashboard
        </Link>
        <h1 className="text-xl font-bold">Set up your Atlas workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Follow these steps to get your agency workspace fully configured.
        </p>
      </div>

      {isLoading && !status ? (
        <SkeletonCard variant="list" />
      ) : (
        <OnboardingChecklist />
      )}
    </div>
  );
}

export function GettingStartedPage() {
  return (
    <SectionErrorBoundary label="Getting started">
      <GettingStartedContent />
    </SectionErrorBoundary>
  );
}
