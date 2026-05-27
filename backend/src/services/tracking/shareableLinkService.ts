import crypto from 'crypto';
import { supabaseAdmin } from '../database/supabase';
import { buildDeliverables } from './deliverableBuilder';

export interface ShareLinkResult {
  share_url: string;
  token: string;
  expires_at: string;
}

export async function generateShareLink(
  clientId: string,
  orgId: string,
  userId: string,
  expiresInDays: number,
  frontendBaseUrl: string,
): Promise<ShareLinkResult> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const { datalayer_spec } = await buildDeliverables(clientId);

  const { error } = await supabaseAdmin
    .from('shareable_deliverable_links')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      share_token: token,
      deliverable_type: 'datalayer_spec',
      content: datalayer_spec,
      expires_at: expiresAt.toISOString(),
      created_by: userId,
    });

  if (error) throw new Error(`Failed to create shareable link: ${error.message}`);

  return {
    share_url: `${frontendBaseUrl}/share/${token}`,
    token,
    expires_at: expiresAt.toISOString(),
  };
}

export interface PublicShareContent {
  deliverable_type: string;
  content: Record<string, unknown>;
  client_name: string;
  expires_at: string;
  generated_at: string;
}

export async function fetchPublicShare(token: string): Promise<PublicShareContent | null> {
  const { data, error } = await supabaseAdmin
    .from('shareable_deliverable_links')
    .select('*, clients(name)')
    .eq('share_token', token)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error?.code === 'PGRST116' || !data) return null;
  if (error) throw new Error(`Failed to fetch share: ${error.message}`);

  const row = data as Record<string, unknown> & { clients?: { name: string } };

  await supabaseAdmin
    .from('shareable_deliverable_links')
    .update({
      view_count: (typeof row.view_count === 'number' ? row.view_count : 0) + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('share_token', token);

  const spec = row.content as Record<string, unknown>;
  return {
    deliverable_type: row.deliverable_type as string,
    content: spec,
    client_name: row.clients?.name ?? 'Unknown client',
    expires_at: row.expires_at as string,
    generated_at: (spec.generated_at as string | undefined) ?? (row.created_at as string),
  };
}
