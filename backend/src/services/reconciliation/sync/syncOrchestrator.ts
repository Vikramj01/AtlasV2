import { supabaseAdmin } from '@/services/database/supabase';
import { syncConversionActions, syncCampaignGoals } from './googleAdsSync';
import { syncCustomConversions, syncAemPriorities, syncMetaCampaigns } from './metaSync';
import { syncKeyEvents } from './ga4Sync';
import { updateLastSynced } from '@/services/database/connectionQueries';
import logger from '@/utils/logger';
import type { Platform } from '@/types/connections';

const SYNC_INTERVAL_MS = 5.5 * 60 * 60 * 1000; // 5.5h buffer before 6h cadence

export interface SyncJobData {
  connectionId: string;
  orgId: string;
  platform: Platform;
}

export async function getConnectionsDueForSync(): Promise<SyncJobData[]> {
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from('platform_connections')
    .select('id, organization_id, platform')
    .eq('status', 'active')
    .in('platform', ['google_ads', 'meta', 'ga4'])
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(100);

  if (error) {
    logger.error({ err: error.message }, 'Failed to query connections due for sync');
    return [];
  }

  return (data ?? []).map((row) => ({
    connectionId: row.id as string,
    orgId: row.organization_id as string,
    platform: row.platform as Platform,
  }));
}

export async function runConfigSyncForConnection(job: SyncJobData): Promise<void> {
  const { connectionId, orgId, platform } = job;

  logger.info({ connectionId, platform }, 'Config sync started');

  try {
    if (platform === 'google_ads') {
      await syncConversionActions(connectionId, orgId);
      await syncCampaignGoals(connectionId, orgId);
    } else if (platform === 'meta') {
      await syncCustomConversions(connectionId, orgId);
      await syncAemPriorities(connectionId, orgId);
      await syncMetaCampaigns(connectionId, orgId);
    } else if (platform === 'ga4') {
      await syncKeyEvents(connectionId, orgId);
    }

    await updateLastSynced(connectionId);
    logger.info({ connectionId, platform }, 'Config sync completed');
  } catch (err) {
    logger.error({ connectionId, platform, err: (err as Error).message }, 'Config sync failed');
    throw err;
  }
}
