import { useOrganisations } from '@/hooks/useOrganisations';
import { FirstTimeSetup } from '@/components/home/FirstTimeSetup';
import { ReturningUserLanding } from '@/components/home/ReturningUserLanding';
import { SkeletonCard } from '@/components/common/SkeletonCard';

/**
 * Post-login landing at "/". Branches purely on organisation existence:
 * no org yet → FirstTimeSetup (create a workspace); org exists →
 * ReturningUserLanding's two-option screen, regardless of how much of the
 * onboarding checklist is still outstanding (that checklist stays reachable
 * at /getting-started, just no longer the default landing).
 */
export function HomePage() {
  const { organisations, loading } = useOrganisations();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <SkeletonCard variant="page" />
      </div>
    );
  }

  if (organisations.length === 0) {
    return <FirstTimeSetup />;
  }

  return <ReturningUserLanding />;
}
