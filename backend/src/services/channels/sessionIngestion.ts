/**
 * Channel Signal Behaviour — Session Ingestion
 *
 * Classifies incoming sessions into acquisition channels, computes a basic
 * signal completion score, and persists to channel_sessions + channel_session_events.
 */

import { upsertChannelSession, insertSessionEvents } from '@/services/database/channelQueries';
import type {
  IngestSessionPayload,
  ChannelType,
  ChannelHints,
  SessionEvent,
} from '@/types/channel';
import logger from '@/utils/logger';

// ── Channel classification ────────────────────────────────────────────────────

/**
 * Classify an acquisition channel from click IDs, UTM params, and referrer.
 *
 * Priority:
 *   1. Click ID  (gclid → google_ads | fbclid → meta_ads | ttclid → tiktok_ads)
 *   2. UTM medium/source
 *   3. Referrer domain
 *   4. Fallback → direct
 */
export function classifyChannel(hints: ChannelHints): ChannelType {
  // 1. Click IDs take highest priority
  if (hints.gclid)   return 'google_ads';
  if (hints.fbclid)  return 'meta_ads';
  if (hints.ttclid)  return 'tiktok_ads';

  const medium = (hints.utm_medium ?? '').toLowerCase().trim();
  const source = (hints.utm_source ?? '').toLowerCase().trim();

  // 2. UTM medium
  if (medium === 'email') return 'email';
  if (medium === 'referral') return 'referral';

  if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
    return mapPaidSource(source);
  }

  if (medium === 'social' || medium === 'paid_social') {
    if (source === 'facebook' || source === 'instagram' || source === 'fb') {
      return 'meta_ads';
    }
    if (source === 'linkedin') return 'linkedin_ads';
    if (source === 'tiktok') return 'tiktok_ads';
    return 'paid_social_other';
  }

  if (medium === 'organic') {
    return 'organic_search';
  }

  // 3. Referrer-based classification
  const referrer = (hints.referrer ?? '').toLowerCase();
  if (referrer) {
    if (isSearchReferrer(referrer))  return 'organic_search';
    if (isSocialReferrer(referrer))  return 'organic_social';
    if (referrer.length > 0)         return 'referral';
  }

  return 'direct';
}

function mapPaidSource(source: string): ChannelType {
  if (source === 'google' || source === 'adwords') return 'google_ads';
  if (source === 'facebook' || source === 'instagram' || source === 'fb') return 'meta_ads';
  if (source === 'linkedin') return 'linkedin_ads';
  if (source === 'tiktok') return 'tiktok_ads';
  return 'paid_search_other';
}

function isSearchReferrer(referrer: string): boolean {
  return (
    referrer.includes('google.') ||
    referrer.includes('bing.com') ||
    referrer.includes('yahoo.com') ||
    referrer.includes('duckduckgo.com') ||
    referrer.includes('baidu.com')
  );
}

function isSocialReferrer(referrer: string): boolean {
  return (
    referrer.includes('facebook.com') ||
    referrer.includes('instagram.com') ||
    referrer.includes('twitter.com') ||
    referrer.includes('x.com') ||
    referrer.includes('linkedin.com') ||
    referrer.includes('tiktok.com') ||
    referrer.includes('pinterest.com') ||
    referrer.includes('reddit.com') ||
    referrer.includes('youtube.com')
  );
}

// ── Signal completion scoring ─────────────────────────────────────────────────

/**
 * Compute a basic signal completion score (0–1) based on the presence and
 * health of events in the session.
 *
 * Rules:
 *   - Healthy events contribute 1.0 each
 *   - Degraded events contribute 0.5 each
 *   - Missing/unknown events contribute 0.0 each
 *   - Score = weighted sum / total events (floor of 0 if no events)
 */
export function computeSignalCompletionScore(events: SessionEvent[]): number {
  if (events.length === 0) return 0;

  // Events don't carry signal_health_status in the payload — that's computed
  // by the validation engine. For ingestion, we give all events a neutral 0.5
  // score and let the health pipeline update it later.
  return 0.5;
}

// ── Main ingestion function ───────────────────────────────────────────────────

export async function ingestSession(
  userId: string,
  payload: IngestSessionPayload,
): Promise<{ session_id: string; channel: ChannelType }> {
  const channel = classifyChannel(payload.channel_hints);
  const scs = computeSignalCompletionScore(payload.events);

  const hasConversion = payload.events.some(
    (e) => e.event_category === 'macro_conversion',
  );
  const pageViews = payload.events.filter((e) => e.event_category === 'page_view');
  const uniquePages = new Set(pageViews.map((e) => e.page_url ?? payload.landing_page)).size;

  const sessionId = await upsertChannelSession(userId, {
    session_ext_id: payload.session_id,
    website_url: payload.website_url,
    channel,
    source: payload.channel_hints.utm_source,
    medium: payload.channel_hints.utm_medium,
    campaign: payload.channel_hints.utm_campaign,
    device_type: normaliseDeviceType(payload.device_type),
    browser: payload.browser,
    landing_page: payload.landing_page,
    started_at: payload.events[0]?.fired_at ?? new Date().toISOString(),
    event_count: payload.events.length,
    page_count: uniquePages,
    conversion_reached: hasConversion,
    signal_completion_score: scs,
  });

  const eventRows = payload.events.map((e, i) => ({
    event_name: e.event_name,
    event_category: e.event_category,
    page_url: e.page_url,
    event_params: e.event_params ?? {},
    signal_health_status: 'unknown' as const,
    seq: i + 1,
    fired_at: e.fired_at,
  }));

  await insertSessionEvents(sessionId, eventRows);

  logger.info(
    { userId, sessionId, channel, eventCount: payload.events.length },
    'Channel session ingested',
  );

  return { session_id: sessionId, channel };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseDeviceType(
  raw?: string,
): 'desktop' | 'mobile' | 'tablet' | 'other' | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === 'desktop') return 'desktop';
  if (v === 'mobile') return 'mobile';
  if (v === 'tablet') return 'tablet';
  return 'other';
}
