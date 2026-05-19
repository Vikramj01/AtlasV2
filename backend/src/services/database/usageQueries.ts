import { supabaseAdmin } from './supabase';
import { sendOperatorAlert } from '@/services/usage/alertDelivery';

// ── Pricing constants — fallback for orgs with no org_subscriptions row ───────
export const PLAN_MRR: Record<string, number> = {
  free:   0,
  pro:    399,
  agency: 799,
};

const MARGIN_ALERT_THRESHOLD = parseFloat(process.env['MARGIN_ALERT_THRESHOLD'] ?? '0.30');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UsagePortfolioRow {
  org_id: string;
  org_name: string;
  plan: string;
  subscription_tier: string | null;
  mrr_usd: number;
  scan_cost_usd: number;
  ai_cost_usd: number;
  total_variable_cost_usd: number;
  gross_margin_pct: number | null;
  margin_status: 'green' | 'amber' | 'red' | 'na';
  total_page_scans: number;
  total_ai_calls: number;
  open_violations_count: number;
  month: string;
}

export interface OrgDailyCost {
  date: string;
  scan_cost_usd: number;
  ai_cost_usd: number;
}

export interface OrgDomainCost {
  domain: string;
  scan_count: number;
  cost_usd: number;
}

export interface OrgAIBreakdown {
  event_type: string;
  call_count: number;
  cost_usd: number;
}

export interface UsageEventRow {
  id: string;
  event_type: string;
  cost_usd: number;
  pages_scanned: number | null;
  browser_minutes: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  domain: string | null;
  model: string | null;
  scan_run_id: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function marginStatus(cost: number, mrr: number): UsagePortfolioRow['margin_status'] {
  if (mrr === 0) return 'na';
  const ratio = cost / mrr;
  if (ratio < 0.15) return 'green';
  if (ratio < 0.30) return 'amber';
  return 'red';
}

function isoMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

// ── Portfolio overview ────────────────────────────────────────────────────────

export async function getUsagePortfolio(monthIso?: string): Promise<UsagePortfolioRow[]> {
  const month = monthIso ?? isoMonth(new Date());

  // usage_monthly_summary has month as a timestamptz truncated to month start
  const monthStart = new Date(month);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const [
    { data: summaryRows },
    { data: orgRows },
    { data: profileRows },
    { data: subRows },
    { data: violationRows },
  ] = await Promise.all([
    supabaseAdmin
      .from('usage_monthly_summary')
      .select('*')
      .gte('month', monthStart.toISOString())
      .lt('month', monthEnd.toISOString()),
    supabaseAdmin.from('organisations').select('id, name'),
    supabaseAdmin.from('profiles').select('organisation_id, plan'),
    supabaseAdmin.from('org_active_subscriptions').select('org_id, mrr_usd, tier'),
    supabaseAdmin.from('cap_violations').select('org_id').eq('resolved', false),
  ]);

  const orgNameMap = new Map<string, string>(
    (orgRows ?? []).map((o) => {
      const r = o as { id: string; name: string };
      return [r.id, r.name];
    }),
  );

  // Per-org: take highest plan across all member profiles
  const planRank = (p: string) => p === 'agency' ? 3 : p === 'pro' ? 2 : 1;
  const orgPlanMap = new Map<string, string>();
  for (const row of profileRows ?? []) {
    const r = row as { organisation_id: string; plan: string };
    const existing = orgPlanMap.get(r.organisation_id);
    if (!existing || planRank(r.plan) > planRank(existing)) {
      orgPlanMap.set(r.organisation_id, r.plan);
    }
  }

  // MRR and commercial tier from org_subscriptions; fall back to PLAN_MRR for unsubscribed orgs
  const mrrByOrg = new Map<string, number>(
    (subRows ?? []).map((s) => {
      const r = s as { org_id: string; mrr_usd: number; tier: string };
      return [r.org_id, Number(r.mrr_usd)];
    }),
  );
  const tierByOrg = new Map<string, string>(
    (subRows ?? []).map((s) => {
      const r = s as { org_id: string; mrr_usd: number; tier: string };
      return [r.org_id, r.tier];
    }),
  );

  // Open cap violations count per org
  const violationsByOrg = new Map<string, number>();
  for (const v of violationRows ?? []) {
    const r = v as { org_id: string };
    violationsByOrg.set(r.org_id, (violationsByOrg.get(r.org_id) ?? 0) + 1);
  }

  return (summaryRows ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const orgId = r['org_id'] as string;
    const plan = orgPlanMap.get(orgId) ?? 'free';
    const mrr = mrrByOrg.get(orgId) ?? PLAN_MRR[plan] ?? 0;
    const totalCost = Number(r['total_variable_cost_usd'] ?? 0);
    const grossMarginPct = mrr > 0 ? Math.round(((mrr - totalCost) / mrr) * 100) : null;

    return {
      org_id:                  orgId,
      org_name:                orgNameMap.get(orgId) ?? orgId.slice(0, 8),
      plan,
      subscription_tier:       tierByOrg.get(orgId) ?? null,
      mrr_usd:                 mrr,
      scan_cost_usd:           Number(r['scan_cost_usd'] ?? 0),
      ai_cost_usd:             Number(r['ai_cost_usd'] ?? 0),
      total_variable_cost_usd: totalCost,
      gross_margin_pct:        grossMarginPct,
      margin_status:           marginStatus(totalCost, mrr),
      total_page_scans:        Number(r['total_page_scans'] ?? 0),
      total_ai_calls:          Number(r['total_ai_calls'] ?? 0),
      open_violations_count:   violationsByOrg.get(orgId) ?? 0,
      month,
    };
  });
}

// ── Per-org drill-down ────────────────────────────────────────────────────────

export async function getOrgDailyBreakdown(orgId: string, days = 30): Promise<OrgDailyCost[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from('usage_events')
    .select('event_type, cost_usd, created_at')
    .eq('org_id', orgId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  // Group by calendar day in TypeScript
  const byDay = new Map<string, { scan: number; ai: number }>();

  for (const row of data ?? []) {
    const r = row as { event_type: string; cost_usd: number; created_at: string };
    const day = r.created_at.slice(0, 10);
    const existing = byDay.get(day) ?? { scan: 0, ai: 0 };
    if (r.event_type === 'page_scan') {
      existing.scan += Number(r.cost_usd);
    } else {
      existing.ai += Number(r.cost_usd);
    }
    byDay.set(day, existing);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, costs]) => ({
      date,
      scan_cost_usd: Math.round(costs.scan * 1_000_000) / 1_000_000,
      ai_cost_usd:   Math.round(costs.ai  * 1_000_000) / 1_000_000,
    }));
}

export async function getOrgDomainBreakdown(orgId: string, monthIso?: string): Promise<OrgDomainCost[]> {
  const month = monthIso ?? isoMonth(new Date());
  const monthStart = new Date(month);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const { data } = await supabaseAdmin
    .from('usage_events')
    .select('domain, cost_usd')
    .eq('org_id', orgId)
    .eq('event_type', 'page_scan')
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', monthEnd.toISOString())
    .not('domain', 'is', null);

  const byDomain = new Map<string, { count: number; cost: number }>();
  for (const row of data ?? []) {
    const r = row as { domain: string; cost_usd: number };
    const existing = byDomain.get(r.domain) ?? { count: 0, cost: 0 };
    existing.count += 1;
    existing.cost += Number(r.cost_usd);
    byDomain.set(r.domain, existing);
  }

  return Array.from(byDomain.entries())
    .map(([domain, { count, cost }]) => ({
      domain,
      scan_count: count,
      cost_usd:   Math.round(cost * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 10);
}

export async function getOrgAIBreakdown(orgId: string, monthIso?: string): Promise<OrgAIBreakdown[]> {
  const month = monthIso ?? isoMonth(new Date());
  const monthStart = new Date(month);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const { data } = await supabaseAdmin
    .from('usage_events')
    .select('event_type, cost_usd')
    .eq('org_id', orgId)
    .like('event_type', 'ai_%')
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', monthEnd.toISOString());

  const byType = new Map<string, { count: number; cost: number }>();
  for (const row of data ?? []) {
    const r = row as { event_type: string; cost_usd: number };
    const existing = byType.get(r.event_type) ?? { count: 0, cost: 0 };
    existing.count += 1;
    existing.cost += Number(r.cost_usd);
    byType.set(r.event_type, existing);
  }

  return Array.from(byType.entries()).map(([event_type, { count, cost }]) => ({
    event_type,
    call_count: count,
    cost_usd:   Math.round(cost * 1_000_000) / 1_000_000,
  }));
}

export async function getOrgRawEvents(
  orgId: string,
  opts: { page?: number; type?: string; from?: string; to?: string },
): Promise<{ events: UsageEventRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from('usage_events')
    .select('id, event_type, cost_usd, pages_scanned, browser_minutes, input_tokens, output_tokens, domain, model, scan_run_id, created_at', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (opts.type) query = query.eq('event_type', opts.type);
  if (opts.from) query = query.gte('created_at', opts.from);
  if (opts.to)   query = query.lte('created_at', opts.to);

  const { data, count } = await query;

  return {
    events: (data ?? []) as UsageEventRow[],
    total:  count ?? 0,
  };
}

// ── Browserbase reconciliation snapshots ─────────────────────────────────────

export interface ReconciliationSnapshot {
  snapshot_date: string;
  total_browser_minutes: number;
  total_proxy_data_gb: number;
  included_minutes: number;
  overage_minutes: number;
  overage_cost_usd: number;
  atlas_logged_minutes: number | null;
  delta_minutes: number;
  created_at: string;
}

export async function getReconciliationSnapshots(limit = 14): Promise<ReconciliationSnapshot[]> {
  const { data, error } = await supabaseAdmin
    .from('browserbase_usage_snapshots')
    .select('snapshot_date, total_browser_minutes, total_proxy_data_gb, included_minutes, overage_minutes, overage_cost_usd, atlas_logged_minutes, delta_minutes, created_at')
    .order('snapshot_date', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch reconciliation snapshots: ${error.message}`);
  }

  return (data ?? []) as ReconciliationSnapshot[];
}

export async function checkAndLogMarginAlerts(): Promise<void> {
  const portfolio = await getUsagePortfolio();
  const alerts = portfolio.filter(
    (row) => row.mrr_usd > 0 && row.total_variable_cost_usd / row.mrr_usd > MARGIN_ALERT_THRESHOLD,
  );

  const deliveries = alerts.map((row) => {
    const pct = ((row.total_variable_cost_usd / row.mrr_usd) * 100).toFixed(1);
    const projected = (row.total_variable_cost_usd / new Date().getDate()) * 30;
    const msg = [
      `⚠️  MARGIN ALERT — ${row.org_name}`,
      `Tier: ${row.subscription_tier ?? row.plan} ($${row.mrr_usd}/mo)`,
      `Variable cost MTD: $${row.total_variable_cost_usd.toFixed(2)} (${pct}% of MRR)`,
      `Projected month-end cost: $${projected.toFixed(2)}`,
      `Action: Review scan frequency or apply a page cap for this account.`,
    ].join('\n');
    return sendOperatorAlert(msg, 'high');
  });

  await Promise.allSettled(deliveries);
}
