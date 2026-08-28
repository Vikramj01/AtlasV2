/**
 * LinkedIn Matched Audiences client (B7, ATLAS_CONVERSION_SIGNAL_LAYER_SPRINT_PLAN.md)
 *
 * Pushes hashed contacts to a LinkedIn Matched Audiences DMP Segment — the
 * second audience-push destination alongside the existing Google DMA path
 * in enricherService.ts. Reuses the org's existing LinkedIn CAPI provider
 * credentials (capi_providers, provider='linkedin') rather than standing up
 * separate OAuth infrastructure — the same access token already used for
 * LinkedIn Conversions API delivery covers Matched Audiences with the right
 * Marketing Developer Platform scopes.
 *
 * NOTE: LinkedIn's exact 2026 Matched Audiences batch-member endpoint and
 * payload shape postdate this code's reference documentation. This
 * implements the documented DMP Segment user-association shape
 * (POST /rest/dmpSegments/{id}/users, add/remove elements keyed by hashed
 * identifier) — verify against LinkedIn's current Marketing API reference
 * before this ships, the same caveat as listLinkedInConversions() in
 * linkedinDelivery.ts.
 */

import { supabaseAdmin } from '@/services/database/supabase';
import { safeDecryptCredentials } from '@/services/capi/credentials';
import logger from '@/utils/logger';
import type { LinkedInCredentials } from '@/types/capi';

const LINKEDIN_API_BASE = 'https://api.linkedin.com';
// Keep in sync with LINKEDIN_VERSION in services/capi/linkedinDelivery.ts —
// both hit the same versioned Marketing API surface.
const LINKEDIN_VERSION = '202608';

export interface LinkedInAudienceMember {
  hashedEmail?: string;
  hashedPhoneNumber?: string;
}

export interface LinkedInAudiencePushResult {
  audience_id: string;
  status: 'ok' | 'error';
  error?: string;
}

async function getLinkedInCredentials(orgId: string): Promise<LinkedInCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('capi_providers')
    .select('credentials')
    .eq('organization_id', orgId)
    .eq('provider', 'linkedin')
    .maybeSingle();

  if (error || !data) return null;
  return safeDecryptCredentials((data as { credentials: unknown }).credentials) as LinkedInCredentials;
}

function buildUserIds(m: LinkedInAudienceMember): Array<{ idType: string; idValue: string }> {
  const ids: Array<{ idType: string; idValue: string }> = [];
  if (m.hashedEmail) ids.push({ idType: 'SHA256_EMAIL', idValue: m.hashedEmail });
  if (m.hashedPhoneNumber) ids.push({ idType: 'SHA256_PHONE', idValue: m.hashedPhoneNumber });
  return ids;
}

/**
 * Push (CREATE) or remove (REMOVE) a batch of already-hashed contacts
 * against a single LinkedIn Matched Audiences segment. Unlike Google DMA,
 * LinkedIn's segment API does not return per-member match confirmation
 * synchronously — this returns one result per destination, not per member.
 */
export async function pushToLinkedInMatchedAudience(
  orgId: string,
  audienceId: string,
  members: LinkedInAudienceMember[],
  operation: 'CREATE' | 'REMOVE',
): Promise<LinkedInAudiencePushResult> {
  const creds = await getLinkedInCredentials(orgId);
  if (!creds) {
    return { audience_id: audienceId, status: 'error', error: 'No LinkedIn CAPI provider connected for this org' };
  }

  const action = operation === 'CREATE' ? 'ADD' : 'REMOVE';

  try {
    const res = await fetch(`${LINKEDIN_API_BASE}/rest/dmpSegments/${encodeURIComponent(audienceId)}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.access_token}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LINKEDIN_VERSION,
      },
      body: JSON.stringify({
        elements: members.map((m) => ({ action, userIds: buildUserIds(m) })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      const error = body.message ?? `LinkedIn Matched Audiences HTTP ${res.status}`;
      logger.warn({ orgId, audienceId, status: res.status }, 'LinkedIn Matched Audiences push failed');
      return { audience_id: audienceId, status: 'error', error };
    }

    return { audience_id: audienceId, status: 'ok' };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Network error';
    logger.error({ err: error, orgId, audienceId }, 'LinkedIn Matched Audiences push threw');
    return { audience_id: audienceId, status: 'error', error };
  }
}
