import { supabaseAdmin } from '@/services/database/supabase';
import { ATLAS_PRICING, getPageCap, getMaxClients, getDomainCap } from '@/config/pricing';
import type { AtlasTier } from '@/config/pricing';
import { upsertCapViolation } from '@/services/database/subscriptionQueries';
import { listActiveSubscriptions } from '@/services/database/subscriptionQueries';
import { sendOperatorAlert } from '@/services/usage/alertDelivery';
import logger from '@/utils/logger';

function formatAlert(params: {
  orgName: string;
  tier: string;
  mrrUsd: number;
  capType: string;
  domain: string | null;
  unit: string;
  capValue: number;
  actual: number;
  usagePct: number;
  severity: 'medium' | 'high';
}): string {
  const lines = [
    `⚠️  FAIR-USE VIOLATION — ${params.orgName}`,
    `Tier: ${params.tier} ($${params.mrrUsd}/mo)`,
    `Cap type: ${params.capType}`,
  ];
  if (params.domain) lines.push(`Domain: ${params.domain}`);
  lines.push(
    `Entitlement: ${params.capValue} ${params.unit}`,
    `Actual this month: ${params.actual} (${(params.usagePct * 100).toFixed(0)}% of cap)`,
    `Severity: ${params.severity.toUpperCase()}`,
  );
  return lines.join('\n');
}

function severityFromPct(usagePct: number): 'medium' | 'high' | null {
  if (usagePct >= 1.5) return 'high';
  if (usagePct >= 1.0) return 'medium';
  return null;
}

// ── Month boundary ─────────────────────────────────────────────────────────────

function currentMonthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Main job ───────────────────────────────────────────────────────────────────

export async function runFairUseCapCheck(): Promise<void> {
  logger.info('Fair-use cap check started');

  const subscriptions = await listActiveSubscriptions();

  if (subscriptions.length === 0) {
    logger.info('Fair-use cap check: no active subscriptions, skipping');
    return;
  }

  const monthStart = currentMonthStart();

  // Pre-fetch org names for alert messages
  const orgIds = subscriptions.map((s) => s.org_id);
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .in('id', orgIds);
  const orgNameById = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? 'Unknown Org']));

  let totalViolations = 0;

  for (const sub of subscriptions) {
    const tier = sub.tier as AtlasTier;
    if (!ATLAS_PRICING[tier]) {
      logger.warn({ orgId: sub.org_id, tier }, 'Fair-use check: unrecognised tier, skipping');
      continue;
    }

    const orgName = orgNameById.get(sub.org_id) ?? sub.org_id;

    // ── Check 1: Page scan cap per domain ────────────────────────────────────

    const { data: scanRows } = await supabaseAdmin
      .from('usage_events')
      .select('domain, pages_scanned')
      .eq('org_id', sub.org_id)
      .eq('event_type', 'page_scan')
      .gte('created_at', monthStart)
      .not('domain', 'is', null);

    // Aggregate pages_scanned per domain
    const pagesByDomain = new Map<string, number>();
    for (const row of scanRows ?? []) {
      const domain = row.domain as string;
      pagesByDomain.set(domain, (pagesByDomain.get(domain) ?? 0) + ((row.pages_scanned as number) ?? 0));
    }

    const pageCap = getPageCap(tier);

    for (const [domain, pages] of pagesByDomain) {
      const usagePct = pages / pageCap;
      const severity = severityFromPct(usagePct);
      if (!severity) continue;

      await upsertCapViolation({
        org_id:     sub.org_id,
        cap_type:   'page_scan',
        domain,
        cap_value:  pageCap,
        actual:     pages,
        usage_pct:  usagePct,
        severity,
        resolved:   false,
        resolved_at: null,
        resolution:  null,
      });

      if (severity === 'high') {
        void sendOperatorAlert(
          formatAlert({
            orgName, tier, mrrUsd: sub.mrr_usd,
            capType: 'Page scans', domain,
            unit: 'pages/domain/month',
            capValue: pageCap, actual: pages, usagePct, severity,
          }),
          severity,
        );
      }

      totalViolations++;
    }

    // ── Check 2: Domain count cap ─────────────────────────────────────────────

    const domainCap = getDomainCap(tier);
    const uniqueDomains = pagesByDomain.size;

    if (uniqueDomains > 0) {
      const domainUsagePct = uniqueDomains / domainCap;
      const domainSeverity = severityFromPct(domainUsagePct);

      if (domainSeverity) {
        await upsertCapViolation({
          org_id:     sub.org_id,
          cap_type:   'domain_count',
          domain:     null,
          cap_value:  domainCap,
          actual:     uniqueDomains,
          usage_pct:  domainUsagePct,
          severity:   domainSeverity,
          resolved:   false,
          resolved_at: null,
          resolution:  null,
        });

        if (domainSeverity === 'high') {
          void sendOperatorAlert(
            formatAlert({
              orgName, tier, mrrUsd: sub.mrr_usd,
              capType: 'Domain count', domain: null,
              unit: 'domains',
              capValue: domainCap, actual: uniqueDomains,
              usagePct: domainUsagePct, severity: domainSeverity,
            }),
            domainSeverity,
          );
        }

        totalViolations++;
      }
    }

    // ── Check 3: Client count cap (agency tiers only) ─────────────────────────

    const maxClients = getMaxClients(tier);
    if (maxClients !== null) {
      const { count: activeClients } = await supabaseAdmin
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('organisation_id', sub.org_id)
        .eq('status', 'active');

      const clientCount = activeClients ?? 0;
      const clientUsagePct = clientCount / maxClients;
      const clientSeverity = severityFromPct(clientUsagePct);

      if (clientSeverity) {
        await upsertCapViolation({
          org_id:     sub.org_id,
          cap_type:   'client_count',
          domain:     null,
          cap_value:  maxClients,
          actual:     clientCount,
          usage_pct:  clientUsagePct,
          severity:   clientSeverity,
          resolved:   false,
          resolved_at: null,
          resolution:  null,
        });

        void sendOperatorAlert(
          formatAlert({
            orgName, tier, mrrUsd: sub.mrr_usd,
            capType: 'Client count', domain: null,
            unit: 'active clients',
            capValue: maxClients, actual: clientCount,
            usagePct: clientUsagePct, severity: clientSeverity,
          }),
          clientSeverity,
        );

        totalViolations++;
      }
    }
  }

  logger.info({ totalViolations }, 'Fair-use cap check complete');
}
