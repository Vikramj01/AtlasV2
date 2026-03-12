import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Map, Zap, ArrowRight, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { auditApi } from '@/lib/api/auditApi';
import { planningApi } from '@/lib/api/planningApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AuditHistoryItem } from '@/components/audit/AuditHistoryTable';
import type { PlanningSession } from '@/types/planning';

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  agency: 'Agency',
};

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-brand-100 text-brand-700',
  agency: 'bg-purple-100 text-purple-700',
};

const AUDIT_STATUS_ICON: Record<string, React.ReactNode> = {
  completed:  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
  running:    <Clock className="h-3.5 w-3.5 text-blue-500 animate-spin" />,
  queued:     <Clock className="h-3.5 w-3.5 text-gray-400" />,
  failed:     <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
};

export function HomePage() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<string>('free');
  const [recentAudits, setRecentAudits] = useState<AuditHistoryItem[]>([]);
  const [recentSessions, setRecentSessions] = useState<PlanningSession[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) return;
      const { data } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', session.user.id)
        .single();
      if (data?.plan) setPlan(data.plan as string);
    });

    auditApi.list()
      .then((items) => setRecentAudits(items.slice(0, 3)))
      .catch(() => {});

    planningApi.listSessions()
      .then(({ sessions }) => setRecentSessions(sessions.slice(0, 3)))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome to Atlas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What would you like to do today?
          </p>
        </div>
        <Badge className={`${PLAN_COLOR[plan] ?? PLAN_COLOR.free} text-xs font-semibold px-2.5 py-1`}>
          {PLAN_LABEL[plan] ?? plan} plan
        </Badge>
      </div>

      {/* Mode selection cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">

        {/* Planning Mode card */}
        <Card className="group cursor-pointer border-2 border-transparent hover:border-primary/20 hover:shadow-md transition-all duration-200"
          onClick={() => navigate('/planning/new')}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Map className="h-5 w-5 text-primary" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Plan your tracking</h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                Scan your website with AI and get a ready-to-import GTM container, dataLayer spec, and implementation guide.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-primary group-hover:gap-2.5 transition-all">
              Start planning
              <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

        {/* Audit Mode card */}
        <Card className="group cursor-pointer border-2 border-transparent hover:border-primary/20 hover:shadow-md transition-all duration-200"
          onClick={() => navigate('/journey/new')}
        >
          <CardContent className="p-6 space-y-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100">
              <Zap className="h-5 w-5 text-amber-600" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Audit your tracking</h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                Validate your existing conversion tracking against 26 rules across GA4, Meta, Google Ads, and sGTM.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 group-hover:gap-2.5 transition-all">
              Run an audit
              <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Recent activity */}
      {(recentAudits.length > 0 || recentSessions.length > 0) && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">

          {/* Recent audits */}
          {recentAudits.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Recent audits</h3>
                <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
                  View all →
                </Link>
              </div>
              <div className="rounded-xl border bg-background divide-y">
                {recentAudits.map((audit) => {
                  const domain = (() => {
                    try { return new URL(audit.website_url).hostname; }
                    catch { return audit.website_url; }
                  })();
                  return (
                    <div key={audit.id} className="flex items-center justify-between px-4 py-3 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {AUDIT_STATUS_ICON[audit.status]}
                        <span className="text-sm font-medium truncate">{domain}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {audit.signal_health != null && (
                          <span className={`text-xs font-semibold tabular-nums ${
                            audit.signal_health >= 80 ? 'text-green-600' :
                            audit.signal_health >= 50 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {Math.round(audit.signal_health)}%
                          </span>
                        )}
                        {audit.status === 'completed' && (
                          <Link
                            to={`/report/${audit.id}`}
                            className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Recent planning sessions */}
          {recentSessions.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Recent plans</h3>
                <Link to="/planning" className="text-xs text-muted-foreground hover:text-foreground">
                  View all →
                </Link>
              </div>
              <div className="rounded-xl border bg-background divide-y">
                {recentSessions.map((s) => {
                  const domain = (() => {
                    try { return new URL(s.website_url).hostname; }
                    catch { return s.website_url; }
                  })();
                  return (
                    <div key={s.id} className="flex items-center justify-between px-4 py-3 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Map className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="text-sm font-medium truncate">{domain}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          s.status === 'outputs_ready' ? 'bg-green-100 text-green-700' :
                          s.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {s.status === 'outputs_ready' ? 'Ready' :
                           s.status === 'review_ready' ? 'Review' :
                           s.status === 'failed' ? 'Failed' : 'In progress'}
                        </span>
                        <button
                          onClick={() => navigate(`/planning/${s.id}`)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

        </div>
      )}

      {/* Empty state when no activity yet */}
      {recentAudits.length === 0 && recentSessions.length === 0 && (
        <div className="rounded-xl border border-dashed bg-background px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No activity yet — choose a mode above to get started.</p>
        </div>
      )}

      {/* Plan usage note */}
      <p className="text-xs text-muted-foreground/60 text-center">
        {plan === 'free' && 'Free plan: 2 audits · 1 planning session per month. '}
        {plan === 'pro' && 'Pro plan: 20 audits · 10 planning sessions per month. '}
        {plan === 'agency' && 'Agency plan: unlimited audits and planning sessions. '}
        <Link to="/settings" className="underline underline-offset-2 hover:text-muted-foreground">
          {plan !== 'agency' ? 'Upgrade plan' : 'Manage plan'}
        </Link>
      </p>

    </div>
  );
}
