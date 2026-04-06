/**
 * TopBar — fixed 64px header.
 *
 * Design spec:
 *   "Top Header: Fixed, 64px height. Contains Workspace badge,
 *    user profile, and sign-out."
 *
 * Left:  Workspace badge (org/workspace name)
 * Right: Plan badge | email | Sign out
 */

import { useNavigate } from 'react-router-dom';
import { LogOut, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ── Plan badge ────────────────────────────────────────────────────────────────

const PLAN_STYLES: Record<string, string> = {
  free:   'bg-[#F9FAFB] text-[#6B7280] border border-[#E5E7EB]',
  pro:    'bg-[#EFF6FF] text-[#2E75B6] border border-[#2E75B6]/20',
  agency: 'bg-[#F5F3FF] text-[#7C3AED] border border-purple-200',
};

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize',
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
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1B2A4A] shrink-0">
        <Building2 className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
      </div>
      <span className="text-sm font-medium text-[#1A1A1A]">{name}</span>
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

export function TopBar({ email, plan = 'free', workspaceName = 'Personal' }: TopBarProps) {
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <header
      className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] bg-white px-6"
      style={{ height: 64 }}
    >
      {/* Left — workspace badge */}
      <WorkspaceBadge name={workspaceName} />

      {/* Right — plan + email + sign out */}
      <div className="flex items-center gap-4">
        <PlanBadge plan={plan} />

        {email && (
          <span className="hidden text-sm text-[#6B7280] sm:block">{email}</span>
        )}

        <div className="h-4 w-px bg-[#E5E7EB]" />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="gap-1.5 text-[#6B7280] hover:text-[#1A1A1A] px-2"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          <span className="hidden sm:inline text-sm">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
