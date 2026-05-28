import { useEffect } from 'react';
import { useOrganisationStore } from '@/store/organisationStore';
import { useDashboardStore } from '@/store/dashboardStore';
import { DeltaHeader } from './DeltaHeader';
import { OrgMetricsStrip } from './OrgMetricsStrip';
import { AlertFeed } from './AlertFeed';
import { ClientHealthList } from './ClientHealthList';
import { SkeletonCard } from '@/components/common/SkeletonCard';

export function ReturningUserDashboard() {
  const { currentOrg } = useOrganisationStore();
  const { summary, summaryLoadState, fetchSummary, reviewAlert, reviewAll } = useDashboardStore();

  useEffect(() => {
    if (summaryLoadState === 'idle') {
      fetchSummary();
    }
  }, [summaryLoadState, fetchSummary]);

  if (summaryLoadState === 'loading' || summaryLoadState === 'idle') {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <SkeletonCard variant="page" />
      </div>
    );
  }

  if (summaryLoadState === 'error' || !summary) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-muted-foreground">Failed to load dashboard. Please refresh.</p>
      </div>
    );
  }

  const orgId = currentOrg?.id ?? '';

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <DeltaHeader
        delta={summary.delta}
        onReviewAll={reviewAll}
      />

      <OrgMetricsStrip metrics={summary.org_metrics} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Alerts
        </h2>
        <AlertFeed
          alerts={summary.alerts}
          onReview={reviewAlert}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Clients
          </h2>
          {summary.clients.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {summary.clients.length} active
            </span>
          )}
        </div>
        <ClientHealthList clients={summary.clients} orgId={orgId} />
      </section>
    </div>
  );
}
