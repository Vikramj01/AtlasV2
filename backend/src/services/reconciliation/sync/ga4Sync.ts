import { supabaseAdmin } from '@/services/database/supabase';
import { resolveTokens } from '@/services/connections/tokenManager';
import logger from '@/utils/logger';

const ADMIN_API_BASE = 'https://analyticsadmin.googleapis.com/v1beta';

async function adminGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${ADMIN_API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`GA4 Admin API ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function syncKeyEvents(connectionId: string, orgId: string): Promise<void> {
  const tokens = await resolveTokens(connectionId);
  const { data: conn } = await supabaseAdmin
    .from('platform_connections')
    .select('account_id')
    .eq('id', connectionId)
    .single();
  if (!conn) return;

  const propertyId = (conn as { account_id: string }).account_id;

  interface KeyEvent {
    name: string;               // e.g. "properties/123/keyEvents/456"
    eventName: string;
    createTime?: string;
    deletable?: boolean;
    custom?: boolean;
    counting_method?: string;   // ONCE_PER_EVENT | ONCE_PER_SESSION
  }

  const data = await adminGet(
    `properties/${propertyId}/keyEvents?pageSize=200`,
    tokens.access_token,
  ) as { keyEvents?: KeyEvent[] };

  const keyEvents = data.keyEvents ?? [];

  for (const ke of keyEvents) {
    const externalId = ke.name ?? ke.eventName;

    const record = {
      connection_id: connectionId,
      organization_id: orgId,
      external_id: externalId,
      name: ke.eventName,
      status: 'ACTIVE',
      category: ke.custom ? 'CUSTOM' : 'STANDARD',
      counting_type: ke.counting_method ?? null,
      raw: ke,
      observed_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from('platform_conversion_actions')
      .upsert(record, { onConflict: 'connection_id,external_id' });

    if (error) {
      logger.warn({ connectionId, externalId, err: error.message }, 'Failed to upsert GA4 key event');
    }
  }

  logger.info({ connectionId, count: keyEvents.length }, 'GA4 key events synced');
}
