import { supabaseAdmin } from '@/services/database/supabase';
import { writeFinding } from './findingWriter';
import { buildNarrative, buildRemediation } from '../codes/findingCodes';
import { checkIdentityIntegrity, type IdentityCheckRow } from './identityIntegrityRules';
import logger from '@/utils/logger';

interface EventRow {
  atlas_event_id: string;
  event_id: string | null;
  dedup_status: 'hit' | 'miss' | 'not_applicable' | null;
  status: string;
  retry_count: number;
  provider_event_name: string;
  provider_config_id: string;
  capi_providers: { provider: string } | { provider: string }[] | null;
}

const VIOLATION_RATE_THRESHOLD = 0.05; // flag when >5% of a (platform, event) bucket violates identity integrity
const SAMPLE_SIZE = 5;

/**
 * Identity-integrity check driven entirely off Atlas's own capi_events data —
 * does NOT call out to platform reporting APIs (that's future work; see the
 * canonical-event-identity plan for scope notes). Scoped by organization_id
 * since capi_providers has no client_id FK (only a caller-supplied
 * project_id) — the calling run's clientId is attached to findings for
 * schema consistency with the other diff dimensions.
 */
export async function runIdentityDiff(
  runId: string,
  clientId: string,
  briefId: string | null,
  orgId: string,
): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('capi_events')
    .select('atlas_event_id, event_id, dedup_status, status, retry_count, provider_event_name, provider_config_id, capi_providers!inner(provider)')
    .eq('organization_id', orgId)
    .gte('processed_at', sevenDaysAgo) as unknown as { data: EventRow[] | null; error: { message: string } | null };

  if (error) {
    throw new Error(`Failed to load capi_events for identity diff: ${error.message}`);
  }
  if (!rows?.length) {
    logger.info({ runId, orgId }, 'No capi_events in window; skipping identity diff');
    return;
  }

  type Bucket = { total: number; violations: number; sampleIds: string[] };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const providerRel = row.capi_providers;
    const platform = (Array.isArray(providerRel) ? providerRel[0]?.provider : providerRel?.provider) ?? 'unknown';
    const key = `${platform}::${row.provider_event_name}`;

    const bucket = buckets.get(key) ?? { total: 0, violations: 0, sampleIds: [] };
    bucket.total += 1;

    const checkRow: IdentityCheckRow = {
      atlas_event_id: row.atlas_event_id,
      event_id: row.event_id,
      dedup_status: row.dedup_status,
      status: row.status,
      retry_count: row.retry_count,
    };
    const result = checkIdentityIntegrity(checkRow);
    if (result.violated) {
      bucket.violations += 1;
      if (bucket.sampleIds.length < SAMPLE_SIZE) bucket.sampleIds.push(row.atlas_event_id);
    }

    buckets.set(key, bucket);
  }

  for (const [key, bucket] of buckets) {
    const [platform, eventName] = key.split('::');
    if (bucket.violations === 0) continue;

    const violationRate = bucket.violations / bucket.total;
    if (violationRate <= VIOLATION_RATE_THRESHOLD) continue;

    await writeFinding({
      runId,
      organizationId: orgId,
      clientId,
      briefId,
      platform,
      dimension: 'delivery',
      severity: 'warning',
      findingCode: 'IDENTITY_NOT_PRESERVED',
      expected: { violation_rate_max: VIOLATION_RATE_THRESHOLD },
      observed: {
        violation_count: bucket.violations,
        total_count: bucket.total,
        sample_atlas_event_ids: bucket.sampleIds,
      },
      narrative: buildNarrative('IDENTITY_NOT_PRESERVED', {
        event_name: eventName,
        platform,
        violation_count: String(bucket.violations),
        total_count: String(bucket.total),
      }),
      remediationHint: buildRemediation('IDENTITY_NOT_PRESERVED', {}),
    });
  }
}
