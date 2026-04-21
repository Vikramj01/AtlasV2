import { supabaseAdmin as supabase } from '@/services/database/supabase';

export interface ActivityItem {
  id: string;
  type: 'capi_event' | 'planning_session' | 'consent_config' | 'offline_upload';
  description: string;
  deep_link: string;
  created_at: string;
}

export async function getRecentActivity(userId: string): Promise<ActivityItem[]> {
  const [capiEvents, planningSessions, consentConfigs, offlineUploads] = await Promise.all([
    supabase
      .from('capi_events')
      .select('id, provider_event_name, status, processed_at')
      .eq('organization_id', userId)
      .order('processed_at', { ascending: false })
      .limit(5),

    supabase
      .from('planning_sessions')
      .select('id, website_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('consent_configs')
      .select('id, mode, created_at')
      .eq('organization_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),

    supabase
      .from('offline_conversion_uploads')
      .select('id, filename, created_at')
      .eq('organization_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  const items: ActivityItem[] = [];

  for (const e of (capiEvents.data ?? [])) {
    const statusLabel =
      e.status === 'delivered'       ? 'delivered' :
      e.status === 'consent_blocked' ? 'blocked by consent' : 'failed';
    items.push({
      id: `capi_event_${e.id}`,
      type: 'capi_event',
      description: `'${e.provider_event_name}' ${statusLabel} via CAPI`,
      deep_link: '/integrations/capi',
      created_at: e.processed_at as string,
    });
  }

  for (const s of (planningSessions.data ?? [])) {
    items.push({
      id: `planning_${s.id}`,
      type: 'planning_session',
      description: `Tracking plan created for ${s.website_url}`,
      deep_link: `/planning/${s.id}`,
      created_at: s.created_at as string,
    });
  }

  for (const c of (consentConfigs.data ?? [])) {
    items.push({
      id: `consent_${c.id}`,
      type: 'consent_config',
      description: `Consent configuration updated (${(c.mode as string | null) ?? 'custom'} mode)`,
      deep_link: '/consent',
      created_at: c.created_at as string,
    });
  }

  for (const u of (offlineUploads.data ?? [])) {
    items.push({
      id: `offline_${u.id}`,
      type: 'offline_upload',
      description: `Offline conversions uploaded — ${u.filename}`,
      deep_link: '/integrations/capi',
      created_at: u.created_at as string,
    });
  }

  return items
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 10);
}
