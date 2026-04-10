import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useBillingStore } from '@/store/billingStore';
import { Button } from '@/components/ui/button';

type Plan = 'free' | 'pro' | 'agency';

const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, agency: 2 };

const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  agency: 'Agency',
};

interface PlanGateProps {
  /** Minimum plan required to see children. */
  minPlan: 'pro' | 'agency';
  children: ReactNode;
  /** Optional override for the feature name shown in the upgrade prompt. */
  featureName?: string;
}

/**
 * PlanGate — renders children if the user's plan meets the minimum requirement.
 * Otherwise renders an upgrade prompt.
 *
 * Usage:
 *   <PlanGate minPlan="pro" featureName="AI Planning Mode">
 *     <PlanningDashboard />
 *   </PlanGate>
 */
export function PlanGate({ minPlan, children, featureName }: PlanGateProps) {
  const { status, loadState, fetchStatus, startCheckout, checkoutLoading } = useBillingStore();

  useEffect(() => {
    if (loadState === 'idle') fetchStatus();
  }, [loadState, fetchStatus]);

  // While loading, render children optimistically to avoid layout flash.
  // The backend will enforce the gate anyway.
  if (loadState === 'idle' || loadState === 'loading') {
    return <>{children}</>;
  }

  const currentPlan: Plan = (status?.plan ?? 'free') as Plan;
  const hasAccess = PLAN_RANK[currentPlan] >= PLAN_RANK[minPlan];

  if (hasAccess) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1B2A4A]/20 bg-[#F8F9FC] px-8 py-16 text-center">
      <div className="mb-3 rounded-full bg-[#EEF1F7] px-3 py-1 text-xs font-semibold text-[#1B2A4A]">
        {PLAN_LABEL[minPlan]} plan required
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">
        {featureName ? `${featureName} is a ${PLAN_LABEL[minPlan]} feature` : `Upgrade to ${PLAN_LABEL[minPlan]}`}
      </h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        {minPlan === 'pro'
          ? 'Upgrade to Pro to unlock AI Planning Mode, scheduled audits, and CAPI integrations.'
          : 'Upgrade to Agency to unlock offline conversions and unlimited everything.'}
      </p>
      <Button
        className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90"
        onClick={() => startCheckout(minPlan)}
        disabled={checkoutLoading}
      >
        {checkoutLoading ? 'Redirecting to checkout…' : `Upgrade to ${PLAN_LABEL[minPlan]}`}
      </Button>
    </div>
  );
}
