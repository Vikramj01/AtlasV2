import { supabaseAdmin } from './supabase';

export interface AdminStats {
  users_total: number;
  users_by_plan: Record<string, number>;
  audits_this_month: number;
  planning_this_month: number;
  health_alerts_active: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  plan: string;
  created_at: string;
  audit_count: number;
  planning_count: number;
}

export interface ActivityItem {
  id: string;
  type: 'audit' | 'planning';
  user_id: string;
  website_url: string;
  status: string;
  funnel_type?: string;
  created_at: string;
}

export interface AdminAlert {
  id: string;
  user_id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  is_active: boolean;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function getAdminStats(): Promise<AdminStats> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    { count: usersTotal },
    { data: planRows },
    { count: auditsThisMonth },
    { count: planningThisMonth },
    { count: alertsActive },
  ] = await Promise.all([
    supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('profiles').select('plan'),
    supabaseAdmin
      .from('audits')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()),
    supabaseAdmin
      .from('planning_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()),
    supabaseAdmin
      .from('health_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true),
  ]);

  const users_by_plan: Record<string, number> = {};
  for (const row of planRows ?? []) {
    const p = (row as { plan: string }).plan;
    users_by_plan[p] = (users_by_plan[p] ?? 0) + 1;
  }

  return {
    users_total: usersTotal ?? 0,
    users_by_plan,
    audits_this_month: auditsThisMonth ?? 0,
    planning_this_month: planningThisMonth ?? 0,
    health_alerts_active: alertsActive ?? 0,
  };
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  // Fetch from Supabase Auth admin API (service role required)
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  const authUsers = authData?.users ?? [];

  // Fetch profiles, audit counts, and planning counts in parallel
  const [{ data: profiles }, { data: auditRows }, { data: planningRows }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, plan'),
    supabaseAdmin.from('audits').select('user_id'),
    supabaseAdmin.from('planning_sessions').select('user_id'),
  ]);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, (p as { id: string; plan: string }).plan]),
  );

  const auditCounts: Record<string, number> = {};
  for (const r of auditRows ?? []) {
    const uid = (r as { user_id: string }).user_id;
    auditCounts[uid] = (auditCounts[uid] ?? 0) + 1;
  }

  const planningCounts: Record<string, number> = {};
  for (const r of planningRows ?? []) {
    const uid = (r as { user_id: string }).user_id;
    planningCounts[uid] = (planningCounts[uid] ?? 0) + 1;
  }

  return authUsers
    .map((u) => ({
      id: u.id,
      email: u.email ?? '',
      plan: profileMap.get(u.id) ?? 'free',
      created_at: u.created_at,
      audit_count: auditCounts[u.id] ?? 0,
      planning_count: planningCounts[u.id] ?? 0,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function setUserPlan(userId: string, plan: string): Promise<void> {
  await supabaseAdmin.from('profiles').update({ plan }).eq('id', userId);
}

export async function getActivityFeed(limit = 50): Promise<ActivityItem[]> {
  const [{ data: audits }, { data: planning }] = await Promise.all([
    supabaseAdmin
      .from('audits')
      .select('id, user_id, website_url, funnel_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('planning_sessions')
      .select('id, user_id, website_url, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const combined: ActivityItem[] = [
    ...(audits ?? []).map((a) => ({ ...(a as object) as ActivityItem, type: 'audit' as const })),
    ...(planning ?? []).map((p) => ({ ...(p as object) as ActivityItem, type: 'planning' as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return combined.slice(0, limit);
}

export async function getAdminAlerts(limit = 100): Promise<AdminAlert[]> {
  const { data } = await supabaseAdmin
    .from('health_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as AdminAlert[];
}

export async function dismissAdminAlert(alertId: string): Promise<void> {
  await supabaseAdmin.from('health_alerts').update({ is_active: false }).eq('id', alertId);
}
