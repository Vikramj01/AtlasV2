// AIR ingestion orchestrator.
// runIngestionForOrg() runs all three platform connectors for one org.
// runIngestionForAllActiveOrgs() discovers eligible orgs and fans out.
//
// Active org definition for AIR: orgs on pro or agency plan with at least
// one active platform_connection (google_ads, meta_ads, or ga4).
// Meta and GA4 connectors land in Sprint 2 — their calls are stubs here.

import { supabaseAdmin } from '@/services/database/supabase';
import { ingestGoogleAds } from '@/services/air/ingestion/googleAdsConnector';
import logger from '@/utils/logger';

// Returns org_ids eligible for AIR ingestion: pro/agency plan + active connections.
export async function getAirEligibleOrgIds(): Promise<string[]> {
  const { data: subs, error } = await supabaseAdmin
    .from('org_subscriptions')
    .select('organization_id')
    .in('plan', ['pro', 'agency'])
    .eq('status', 'active');

  if (error) {
    logger.error({ err: error.message }, 'AIR orchestrator: failed to query org_subscriptions');
    return [];
  }

  if (!subs || subs.length === 0) return [];

  const subOrgs = new Set((subs as { organization_id: string }[]).map((r) => r.organization_id));

  // Further filter to orgs that have at least one active platform connection
  const { data: conns } = await supabaseAdmin
    .from('platform_connections')
    .select('organization_id')
    .in('platform', ['google_ads', 'meta_ads', 'ga4'])
    .in('status', ['active', 'connected']);

  const connOrgs = new Set(
    (conns ?? []).map((r) => (r as { organization_id: string }).organization_id),
  );

  return Array.from(subOrgs).filter((id) => connOrgs.has(id));
}

// Runs the ingestion pipeline for a single org.
// Each connector is isolated — a failure in one does not cancel the others.
export async function runIngestionForOrg(
  orgId: string,
  date?: string,
): Promise<void> {
  logger.info({ orgId, date }, 'AIR ingestion: starting');

  await Promise.allSettled([
    ingestGoogleAds(orgId, date).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId }, 'AIR/google_ads: ingestion failed'),
    ),
    // Sprint 2: ingestMetaAds(orgId, date)
    // Sprint 2: ingestGA4(orgId, date)
  ]);

  logger.info({ orgId }, 'AIR ingestion: complete');
}

// Discovers all eligible orgs and fans out to per-org ingestion.
export async function runIngestionForAllActiveOrgs(): Promise<void> {
  const orgIds = await getAirEligibleOrgIds();
  logger.info({ count: orgIds.length }, 'AIR ingestion: running for eligible orgs');

  for (const orgId of orgIds) {
    try {
      await runIngestionForOrg(orgId);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err), orgId }, 'AIR orchestrator: per-org failure');
    }
  }
}
