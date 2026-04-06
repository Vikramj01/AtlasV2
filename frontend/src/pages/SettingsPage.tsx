import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const PLAN_CONFIG = {
  free: {
    label: 'Free',
    badge: 'bg-gray-100 text-gray-700',
    description: '2 audits / month · 1 planning session / month',
  },
  pro: {
    label: 'Pro',
    badge: 'bg-[#EEF1F7] text-[#1B2A4A]',
    description: '20 audits / month · 10 planning sessions / month',
  },
  agency: {
    label: 'Agency',
    badge: 'bg-purple-100 text-purple-700',
    description: 'Unlimited audits · Unlimited planning sessions',
  },
} as const;

type Plan = keyof typeof PLAN_CONFIG;

export function SettingsPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>('');
  const [plan, setPlan] = useState<Plan>('free');
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) {
        navigate('/login');
        return;
      }
      setEmail(session.user.email ?? '');

      const { data } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', session.user.id)
        .single();
      if (data?.plan && data.plan in PLAN_CONFIG) {
        setPlan(data.plan as Plan);
      }
      setIsLoading(false);
    });
  }, [navigate]);

  async function handleSignOut() {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    navigate('/login');
  }

  const planInfo = PLAN_CONFIG[plan];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1B2A4A]/20 border-t-[#1B2A4A]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and plan.</p>
      </div>

      {/* Account */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Account</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
              <p className="mt-0.5 text-sm text-foreground">{email}</p>
            </div>
          </div>
          <Separator />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Plan</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5">
          {/* Current plan */}
          <div className="flex items-center gap-3 mb-6">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${planInfo.badge}`}>
              {planInfo.label}
            </span>
            <span className="text-sm text-muted-foreground">{planInfo.description}</span>
          </div>

          {/* Upgrade options — shown only if not already on agency */}
          {plan !== 'agency' && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upgrade</p>

              {/* Pro */}
              {plan === 'free' && (
                <div className="flex items-center justify-between rounded-lg border border-[#1B2A4A]/20 bg-[#EEF1F7] px-4 py-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Pro
                      <span className="ml-2 text-xs font-normal text-muted-foreground">20 audits · 10 planning sessions / month</span>
                    </p>
                  </div>
                  <UpgradeButton priceEnvKey="VITE_STRIPE_PRICE_PRO" label="Upgrade to Pro" />
                </div>
              )}

              {/* Agency */}
              <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Agency
                    <span className="ml-2 text-xs font-normal text-muted-foreground">Unlimited audits · Unlimited planning sessions</span>
                  </p>
                </div>
                <UpgradeButton priceEnvKey="VITE_STRIPE_PRICE_AGENCY" label="Upgrade to Agency" />
              </div>
            </div>
          )}

          {plan === 'agency' && (
            <p className="text-sm text-muted-foreground">
              You're on the Agency plan — all features are unlimited.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Upgrade button ─────────────────────────────────────────────────────────────

function UpgradeButton({ priceEnvKey, label }: { priceEnvKey: string; label: string }) {
  const stripeUrl = (import.meta.env as Record<string, string>)[priceEnvKey];

  if (stripeUrl) {
    return (
      <a
        href={stripeUrl}
        className="flex-shrink-0 rounded-lg bg-[#1B2A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#1B2A4A]"
      >
        {label}
      </a>
    );
  }

  return (
    <a
      href="mailto:hello@atlas.io?subject=Upgrade inquiry"
      className="flex-shrink-0 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
    >
      Contact us
    </a>
  );
}
