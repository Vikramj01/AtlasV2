/**
 * TopBar — fixed 60px header, console light theme.
 *
 * Left:  Workspace badge (org/workspace name)
 * Right: Plan badge | email | Sign out
 */

import { useNavigate } from 'react-router-dom';
import { LogOut, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OnboardingWidget } from '@/components/onboarding/OnboardingWidget';
import { useOnboardingStore } from '@/store/onboardingStore';

// ── Plan badge ────────────────────────────────────────────────────────────────

const PLAN_STYLES: Record<string, string> = {
  free:   'bg-console-chip text-console-fg-muted border border-console-border',
  pro:    'bg-[#EFF6FF] text-[#2E75B6] border border-[#2E75B6]/20',
  agency: 'bg-[#F5F3FF] text-console-violet border border-console-violet/20',
};

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]',
        PLAN_STYLES[plan] ?? PLAN_STYLES.free,
      )}
    >
      {plan}
    </span>
  );
}

// ── Workspace badge ───────────────────────────────────────────────────────────

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-console-border bg-console-chip shrink-0">
        <Building2 className="h-3.5 w-3.5 text-console-fg-subtle" strokeWidth={1.5} />
      </div>
      <span className="font-heading text-[15px] font-semibold text-console-fg">{name}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface TopBarProps {
  email?: string;
  plan?: string;
  /** Workspace or organisation name shown on the left */
  workspaceName?: string;
}

export function TopBar({ email, plan = 'free', workspaceName }: TopBarProps) {
  const navigate = useNavigate();
  const { status: onboardingStatus } = useOnboardingStore();

  const showWidget =
    onboardingStatus !== null &&
    (!!onboardingStatus.dismissed_at || onboardingStatus.overall_status === 'complete');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-console-border bg-console-surface/80 backdrop-blur-md px-7"
      style={{ height: 60 }}
    >
      {/* Left — workspace badge (only when an org is active) */}
      {workspaceName && <WorkspaceBadge name={workspaceName} />}

      {/* Right — plan + email + sign out */}
      <div className="flex items-center gap-4">
        {showWidget && <OnboardingWidget />}
        <PlanBadge plan={plan} />

        {email && (
          <span className="hidden font-mono text-xs text-console-fg-muted sm:block">{email}</span>
        )}

        <div className="h-4 w-px bg-console-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="gap-1.5 font-heading font-semibold text-console-fg-muted hover:text-console-fg px-2"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          <span className="hidden sm:inline text-sm">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
