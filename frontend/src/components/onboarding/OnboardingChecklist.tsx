import { useOnboardingStore } from '@/store/onboardingStore';
import { useOrganisationStore } from '@/store/organisationStore';
import { OnboardingStep } from './OnboardingStep';
import { SkeletonCard } from '@/components/common/SkeletonCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepDef {
  id: string;
  phase: 1 | 2;
  title: string;
  description: string;
  helperCopy?: string;
  required: boolean;
  ctaLabel: string;
  ctaHref?: (firstClientId?: string) => string;
  ctaAction?: 'accept-taxonomy';
  altCtaLabel?: string;
  altCtaAction?: 'accept-taxonomy';
  skipLabel?: string;
  estimatedTime: string;
}

const STEP_DEFS: StepDef[] = [
  {
    id: '1.1', phase: 1, required: true,
    title: 'Set naming conventions',
    description: 'Define how event and parameter names are formatted across your workspace.',
    ctaLabel: 'Set conventions',
    ctaHref: () => '/settings',
    estimatedTime: '~2 min',
  },
  {
    id: '1.2', phase: 1, required: false,
    title: 'Review event taxonomy',
    description: 'Browse the default Atlas event library and accept or customise it for your org.',
    ctaLabel: 'Review taxonomy',
    ctaHref: () => '/signals',
    altCtaLabel: 'Accept defaults',
    altCtaAction: 'accept-taxonomy',
    skipLabel: 'Skip for now',
    estimatedTime: '~1 min',
  },
  {
    id: '1.3', phase: 1, required: false,
    title: 'Choose a starter signal pack',
    description: 'Pick a pre-built pack of signals for your business type to get started fast.',
    ctaLabel: 'Choose a starter pack',
    ctaHref: () => '/signal-packs?filter=starter',
    skipLabel: "I'll build my own later",
    estimatedTime: '~2 min',
  },
  {
    id: '1.4', phase: 1, required: false,
    title: 'Invite your team',
    description: 'Add team members so they can collaborate on client setups.',
    ctaLabel: 'Invite teammates',
    ctaHref: () => '/org/settings',
    skipLabel: "I'll do this later",
    estimatedTime: '~1 min',
  },
  {
    id: '2.1', phase: 2, required: true,
    title: 'Add your first client',
    description: 'Create a client workspace with their website URL and business type.',
    ctaLabel: 'Add a client',
    ctaHref: () => '/clients',
    estimatedTime: '~3 min',
  },
  {
    id: '2.2', phase: 2, required: true,
    title: 'Connect platforms',
    description: 'Link at least one advertising or analytics platform (Google Ads, Meta, or GA4).',
    ctaLabel: 'Connect platforms',
    ctaHref: (id) => id ? `/connections?client_id=${id}` : '/connections',
    estimatedTime: '~5 min',
  },
  {
    id: '2.3', phase: 2, required: true,
    title: 'Design your tagging',
    description: 'Use the Set Up Tracking Hub to plan or audit your client\'s tracking implementation.',
    ctaLabel: 'Set up tracking',
    ctaHref: (id) => id ? `/clients/${id}/tracking` : '/clients',
    estimatedTime: '~15 min',
  },
  {
    id: '2.4', phase: 2, required: true,
    title: 'Generate deliverables',
    description: 'Export the GTM container and datalayer spec for your developer.',
    ctaLabel: 'Generate deliverables',
    ctaHref: (id) => id ? `/clients/${id}/tracking#deliverables` : '/clients',
    estimatedTime: '~1 min',
  },
  {
    id: '2.5', phase: 2, required: true,
    title: 'Verify your implementation',
    description: 'Run a baseline scan once your developer has implemented the tracking.',
    helperCopy: 'Once your developer has implemented the dataLayer and imported the GTM container, run this scan to confirm signals are firing.',
    ctaLabel: 'Run verification scan',
    ctaHref: (id) => id ? `/clients/${id}/tracking#verification` : '/clients',
    estimatedTime: '~5 min',
  },
];

export function OnboardingChecklist() {
  const { status, isLoading, error, completedCount, totalSteps, skipStep, dismiss, acceptTaxonomy } = useOnboardingStore();
  const { currentOrg } = useOrganisationStore();

  if (isLoading) return <SkeletonCard variant="list" />;
  if (error || !status) return null;

  const isBrand = status.org_type === 'brand';
  const firstClientId = status.primary_client_id ?? status.first_client?.id;
  // For brand orgs, adapt certain step labels/descriptions
  const effectiveDefs = isBrand
    ? STEP_DEFS.map((d) => {
        if (d.id === '2.1') {
          return {
            ...d,
            title: 'Your website is set up',
            description: 'Your primary website was automatically added when you created your workspace.',
            ctaLabel: 'View tracking hub',
            ctaHref: firstClientId ? () => `/clients/${firstClientId}/tracking` : d.ctaHref,
          };
        }
        if (d.id === '2.2') {
          return {
            ...d,
            ctaHref: (id?: string) => id ? `/connections?client_id=${id}` : '/connections',
          };
        }
        return d;
      })
    : STEP_DEFS;

  const phase1Defs = effectiveDefs.filter((d) => d.phase === 1);
  const phase2Defs = effectiveDefs.filter((d) => d.phase === 2);

  // Find first incomplete step (for "current" highlight)
  const firstIncompleteId = STEP_DEFS.find((d) => status.steps[d.id]?.status === 'incomplete')?.id;

  function resolveCtaHref(def: StepDef): string | undefined {
    return def.ctaHref?.(firstClientId);
  }

  function resolveCtaAction(def: StepDef): (() => void) | undefined {
    if (def.ctaAction === 'accept-taxonomy') return () => acceptTaxonomy();
    return undefined;
  }

  function resolveAltCtaAction(def: StepDef): (() => void) | undefined {
    if (def.altCtaAction === 'accept-taxonomy') return () => acceptTaxonomy();
    return undefined;
  }

  const isAllDone = status.overall_status === 'complete';

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">
              {isAllDone ? `${currentOrg?.name ?? 'Your workspace'} is ready to go` : 'Set up your Atlas workspace'}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isAllDone
                ? 'All setup steps are complete.'
                : `${completedCount} of ${totalSteps} steps complete`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground hover:text-foreground -mt-1 -mr-1"
            onClick={dismiss}
            aria-label="Dismiss checklist"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isAllDone ? 'bg-green-500' : 'bg-primary',
            )}
            style={{ width: `${Math.round((completedCount / totalSteps) * 100)}%` }}
          />
        </div>

        {isAllDone && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <p className="text-sm text-green-700 font-medium">
              {currentOrg?.name ?? 'Your workspace'} is fully set up. You can dismiss this checklist.
            </p>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6 pt-0">
        {/* Phase 1 */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Phase 1 — Org defaults
          </h3>
          <div className="space-y-2">
            {phase1Defs.map((def) => {
              const step = status.steps[def.id];
              const stepStatus = step?.status ?? 'incomplete';
              const isCurrentStep = def.id === firstIncompleteId;

              return (
                <OnboardingStep
                  key={def.id}
                  stepId={def.id}
                  title={def.title}
                  description={def.description}
                  helperCopy={def.helperCopy}
                  status={stepStatus}
                  required={def.required}
                  ctaLabel={def.ctaLabel}
                  ctaHref={resolveCtaHref(def)}
                  ctaAction={resolveCtaAction(def)}
                  altCtaLabel={def.altCtaLabel}
                  altCtaAction={resolveAltCtaAction(def)}
                  skipLabel={def.skipLabel}
                  onSkip={
                    stepStatus === 'skipped'
                      ? () => skipStep(def.id)
                      : def.skipLabel
                      ? () => skipStep(def.id)
                      : undefined
                  }
                  estimatedTime={def.estimatedTime}
                  isFirst={isCurrentStep}
                />
              );
            })}
          </div>
        </div>

        {/* Phase 2 */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Phase 2 — First client
            </h3>
            {!status.phase_1_complete && (
              <span className="text-xs text-muted-foreground italic">(complete org setup above first)</span>
            )}
          </div>
          <div className="space-y-2">
            {phase2Defs.map((def) => {
              const step = status.steps[def.id];
              const stepStatus = step?.status ?? 'incomplete';
              const isCurrentStep = def.id === firstIncompleteId;

              return (
                <OnboardingStep
                  key={def.id}
                  stepId={def.id}
                  title={def.title}
                  description={def.description}
                  helperCopy={def.helperCopy}
                  status={stepStatus}
                  required={def.required}
                  ctaLabel={def.ctaLabel}
                  ctaHref={resolveCtaHref(def)}
                  ctaAction={resolveCtaAction(def)}
                  skipLabel={def.skipLabel}
                  onSkip={def.skipLabel ? () => skipStep(def.id) : undefined}
                  estimatedTime={def.estimatedTime}
                  isFirst={isCurrentStep}
                />
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
