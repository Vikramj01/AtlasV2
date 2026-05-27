import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { SectionErrorBoundary } from '@/components/common/ErrorBoundary';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { IntentCard } from '@/components/tracking/IntentCard';
import { InProgressBanner } from '@/components/tracking/InProgressBanner';
import { TaggingSummaryCard } from '@/components/tracking/TaggingSummaryCard';
import { DeliverablesCard } from '@/components/tracking/DeliverablesCard';
import { VerificationCard } from '@/components/tracking/VerificationCard';
import { RedesignDrawer } from '@/components/tracking/RedesignDrawer';
import { useTrackingHubStore } from '@/store/trackingHubStore';
import { useOrganisationStore } from '@/store/organisationStore';

function formatSessionLabel(session: { started_at: string; page_count: number; approved_count: number }): string {
  const daysAgo = Math.floor((Date.now() - new Date(session.started_at).getTime()) / (1000 * 60 * 60 * 24));
  const daysLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
  return `Planning session · started ${daysLabel} · ${session.approved_count} of ${session.page_count} pages reviewed`;
}

function formatJourneyLabel(draft: { saved_at: string; current_step: number; total_steps: number }): string {
  const daysAgo = Math.floor((Date.now() - new Date(draft.saved_at).getTime()) / (1000 * 60 * 60 * 24));
  const daysLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
  return `Journey draft · last saved ${daysLabel} · step ${draft.current_step} of ${draft.total_steps}`;
}

function SetupTrackingHubContent() {
  const { clientId } = useParams<{ clientId: string }>();
  const { status, hubState, isLoading, error, fetchStatus, discardInProgress, reset } = useTrackingHubStore();
  const { currentOrg } = useOrganisationStore();

  useEffect(() => {
    if (clientId) {
      fetchStatus(clientId);
    }
    return () => { reset(); };
  }, [clientId, fetchStatus, reset]);

  if (isLoading) return <SkeletonCard variant="page" />;

  if (error || !status) {
    return (
      <div className="p-6 text-sm text-red-600">
        {error ?? 'Unable to load tracking hub.'}
      </div>
    );
  }

  const { client, preconditions, in_progress, deployment, verification } = status;
  const subscription_supports_cse = (currentOrg as unknown as Record<string, unknown> | null)?.plan === 'pro'
    || (currentOrg as unknown as Record<string, unknown> | null)?.plan === 'agency';

  const enrichedPreconditions = { ...preconditions, subscription_supports_cse: !!subscription_supports_cse };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Set up tracking</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{client.name}</p>
      </div>

      {/* State A — Empty */}
      {hubState === 'empty' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold">How would you like to set up tracking for {client.name}?</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Choose an approach based on where your client is starting from.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <IntentCard
              intent="plan_from_scratch"
              preconditions={enrichedPreconditions}
              clientId={clientId!}
              businessType={client.business_type}
              onPreconditionSaved={() => fetchStatus(clientId!)}
            />
            <IntentCard
              intent="audit_existing"
              preconditions={enrichedPreconditions}
              clientId={clientId!}
              businessType={client.business_type}
              onPreconditionSaved={() => fetchStatus(clientId!)}
            />
            <IntentCard
              intent="inventory"
              preconditions={enrichedPreconditions}
              clientId={clientId!}
              businessType={client.business_type}
              onPreconditionSaved={() => fetchStatus(clientId!)}
            />
          </div>
        </div>
      )}

      {/* State B — In progress */}
      {hubState === 'in_progress' && (
        <div className="space-y-6">
          <div className="space-y-3">
            {in_progress.planning_session && (
              <InProgressBanner
                module="planning"
                detail={{
                  id: in_progress.planning_session.id,
                  label: formatSessionLabel(in_progress.planning_session),
                  resume_url: `/planning/${in_progress.planning_session.id}`,
                }}
                onDiscard={() => discardInProgress('planning', in_progress.planning_session!.id)}
              />
            )}
            {in_progress.journey_draft && (
              <InProgressBanner
                module="journey"
                detail={{
                  id: in_progress.journey_draft.id,
                  label: formatJourneyLabel(in_progress.journey_draft),
                  resume_url: `/journey/${in_progress.journey_draft.id}/spec`,
                }}
                onDiscard={() => discardInProgress('journey', in_progress.journey_draft!.id)}
              />
            )}
            {in_progress.recent_crawl && (
              <InProgressBanner
                module="crawl"
                detail={{
                  id: in_progress.recent_crawl.run_id,
                  label: `Site scan · ${in_progress.recent_crawl.signals_found} pages found`,
                  resume_url: `/crawl/${in_progress.recent_crawl.run_id}`,
                }}
                onDiscard={() => discardInProgress('crawl', in_progress.recent_crawl!.run_id)}
              />
            )}
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-4">Continue or start a fresh approach.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <IntentCard
                intent="plan_from_scratch"
                preconditions={enrichedPreconditions}
                clientId={clientId!}
                businessType={client.business_type}
                onPreconditionSaved={() => fetchStatus(clientId!)}
              />
              <IntentCard
                intent="audit_existing"
                preconditions={enrichedPreconditions}
                clientId={clientId!}
                businessType={client.business_type}
                onPreconditionSaved={() => fetchStatus(clientId!)}
              />
              <IntentCard
                intent="inventory"
                preconditions={enrichedPreconditions}
                clientId={clientId!}
                businessType={client.business_type}
                onPreconditionSaved={() => fetchStatus(clientId!)}
              />
            </div>
          </div>
        </div>
      )}

      {/* State C — Complete */}
      {hubState === 'complete' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TaggingSummaryCard clientId={clientId!} deployment={deployment} />
            <DeliverablesCard clientId={clientId!} deliverables={deployment.deliverables} />
            <VerificationCard
              clientId={clientId!}
              siteUrl={client.website_url}
              verification={verification}
            />
          </div>

          <RedesignDrawer
            clientId={clientId!}
            businessType={client.business_type}
            preconditions={enrichedPreconditions}
            hasBaseline={verification.baseline.set}
            onPreconditionSaved={() => fetchStatus(clientId!)}
          />
        </div>
      )}
    </div>
  );
}

export function SetupTrackingHubPage() {
  return (
    <SectionErrorBoundary label="Set up tracking">
      <SetupTrackingHubContent />
    </SectionErrorBoundary>
  );
}
