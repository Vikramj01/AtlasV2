import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useBillingStore } from '@/store/billingStore';
import { strategyApi } from '@/lib/api/strategyApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Lock, Plus, ExternalLink } from 'lucide-react';
import type { StrategyBriefRecord } from '@/types/strategy';

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
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const {
    status,
    loadState,
    checkoutLoading,
    portalLoading,
    error,
    fetchStatus,
    startCheckout,
    openPortal,
  } = useBillingStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        navigate('/login');
        return;
      }
      setEmail(session.user.email ?? '');
      setIsAuthLoading(false);
    });
  }, [navigate]);

  useEffect(() => {
    if (!isAuthLoading) fetchStatus();
  }, [isAuthLoading, fetchStatus]);

  async function handleSignOut() {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    navigate('/login');
  }

  const isLoading = isAuthLoading || loadState === 'loading';
  const isSuperAdmin = status?.isSuperAdmin ?? false;
  const plan: Plan = (status?.plan ?? 'free') as Plan;
  const planInfo = PLAN_CONFIG[plan];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1B2A4A]/20 border-t-[#1B2A4A]" />
      </div>
    );
  }

  const [briefs, setBriefs] = useState<StrategyBriefRecord[]>([]);

  useEffect(() => {
    strategyApi.listBriefs().then((res) => setBriefs(res.data ?? [])).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and plan.</p>
      </div>

      {/* Past-due banner */}
      {status?.subscription_status === 'past_due' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Your last payment failed.{' '}
          <button
            className="font-semibold underline"
            onClick={() => openPortal()}
            disabled={portalLoading}
          >
            Update your payment details
          </button>{' '}
          to keep your plan active.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

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

      {/* Strategy Briefs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Strategy Briefs</CardTitle>
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => navigate('/planning/strategy')}>
              <Plus className="h-3 w-3 mr-1" />
              New brief
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          {briefs.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-xs text-muted-foreground">No strategy briefs yet.</p>
              <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => navigate('/planning/strategy')}>
                Create your first brief
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {briefs.map((brief) => (
                <div key={brief.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium">
                      {brief.brief_name ?? 'Untitled brief'}
                      <span className="ml-1.5 text-muted-foreground font-normal">v{brief.version_no}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {brief.locked_at
                        ? `Locked ${new Date(brief.locked_at).toLocaleDateString()}`
                        : 'Draft — not yet locked'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {brief.locked_at && <Lock className="size-3 text-green-600" />}
                    {brief.locked_at ? (
                      <Link
                        to={`/strategy/briefs/${brief.id}`}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        View <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => navigate('/planning/strategy')}>
                        Continue
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Plan</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5">

          {/* ── Super admin — no billing UI ── */}
          {isSuperAdmin ? (
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-[#1B2A4A] px-3 py-1 text-xs font-semibold text-white">
                Super Admin
              </span>
              <span className="text-sm text-muted-foreground">
                Full platform access · Not connected to billing
              </span>
            </div>
          ) : (
            <>
              {/* Current plan */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${planInfo.badge}`}>
                    {planInfo.label}
                  </span>
                  <span className="text-sm text-muted-foreground">{planInfo.description}</span>
                </div>

                {/* Manage subscription — shown for paying customers */}
                {plan !== 'free' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openPortal()}
                    disabled={portalLoading}
                  >
                    {portalLoading ? 'Opening…' : 'Manage subscription'}
                  </Button>
                )}
              </div>

              {/* Renewal info */}
              {status?.current_period_end && plan !== 'free' && (
                <p className="mb-5 text-xs text-muted-foreground">
                  {status.subscription_status === 'canceled'
                    ? `Access until ${new Date(status.current_period_end).toLocaleDateString()}`
                    : `Renews ${new Date(status.current_period_end).toLocaleDateString()}`}
                </p>
              )}

              {/* Upgrade options */}
              {plan !== 'agency' && (
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Upgrade</p>

                  {plan === 'free' && (
                    <div className="flex items-center justify-between rounded-lg border border-[#1B2A4A]/20 bg-[#EEF1F7] px-4 py-4">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Pro
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            20 audits · 10 planning sessions / month
                          </span>
                        </p>
                      </div>
                      <Button
                        size="sm"
                        className="bg-[#1B2A4A] text-white hover:bg-[#1B2A4A]/90 flex-shrink-0"
                        onClick={() => startCheckout('pro')}
                        disabled={checkoutLoading}
                      >
                        {checkoutLoading ? 'Redirecting…' : 'Upgrade to Pro'}
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50 px-4 py-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Agency
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Unlimited audits · Unlimited planning sessions
                        </span>
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-purple-700 text-white hover:bg-purple-800 flex-shrink-0"
                      onClick={() => startCheckout('agency')}
                      disabled={checkoutLoading}
                    >
                      {checkoutLoading ? 'Redirecting…' : 'Upgrade to Agency'}
                    </Button>
                  </div>
                </div>
              )}

              {plan === 'agency' && (
                <p className="text-sm text-muted-foreground">
                  You're on the Agency plan — all features are unlimited.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
