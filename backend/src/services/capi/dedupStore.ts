import Redis, { type RedisOptions } from 'ioredis';
import { env } from '@/config/env';

const META_TTL_S     = 48 * 60 * 60;       // 48 hours — Meta dedup window
const GOOGLE_TTL_S   = 90 * 24 * 60 * 60; // 90 days  — Google dedup window
const LINKEDIN_TTL_S = 48 * 60 * 60;       // 48 hours — LinkedIn dedup window
const AMAZON_TTL_S   = 24 * 60 * 60;       // 24 hours — Amazon dedup window

function buildRedisClient(): Redis {
  const parsed = new URL(env.REDIS_URL);
  const opts: RedisOptions = {
    host:        parsed.hostname,
    port:        Number(parsed.port) || 6379,
    password:    parsed.password || undefined,
    username:    parsed.username && parsed.username !== 'default' ? parsed.username : undefined,
    lazyConnect: true,
  };
  if (parsed.protocol === 'rediss:') {
    opts.tls = { rejectUnauthorized: false };
  }
  return new Redis(opts);
}

// Dedicated Redis client for dedup lookups — separate from Bull's internal connections.
export const dedupRedis = buildRedisClient();

export interface DedupEntry {
  event_id:    string;
  timestamp:   number;
  event_data?: Record<string, unknown>;
}

function metaKey(providerId: string, fbclid: string, eventName: string): string {
  return `capi:meta:dedup:${providerId}:${fbclid}:${eventName}`;
}

function googleKey(providerId: string, identifier: string, eventName: string): string {
  return `capi:google:dedup:${providerId}:${identifier}:${eventName}`;
}

function linkedinKey(providerId: string, eventId: string, eventName: string): string {
  return `capi:linkedin:dedup:${providerId}:${eventId}:${eventName}`;
}

function amazonKey(providerId: string, identifier: string, eventName: string): string {
  return `capi:amazon:dedup:${providerId}:${identifier}:${eventName}`;
}

export async function getMetaDedupEntry(
  providerId: string,
  fbclid: string | null,
  eventName: string,
): Promise<DedupEntry | null> {
  if (!fbclid) return null;
  const raw = await dedupRedis.get(metaKey(providerId, fbclid, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function getGoogleDedupEntry(
  providerId: string,
  identifier: string | null,
  eventName: string,
): Promise<DedupEntry | null> {
  if (!identifier) return null;
  const raw = await dedupRedis.get(googleKey(providerId, identifier, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function getLinkedInDedupEntry(
  providerId: string,
  eventId: string | null,
  eventName: string,
): Promise<DedupEntry | null> {
  if (!eventId) return null;
  const raw = await dedupRedis.get(linkedinKey(providerId, eventId, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function getAmazonDedupEntry(
  providerId: string,
  identifier: string | null,
  eventName: string,
): Promise<DedupEntry | null> {
  if (!identifier) return null;
  const raw = await dedupRedis.get(amazonKey(providerId, identifier, eventName));
  return raw ? (JSON.parse(raw) as DedupEntry) : null;
}

export async function setDedupEntry(
  provider: 'meta' | 'google' | 'linkedin' | 'amazon',
  providerId: string,
  identifier: string,
  eventName: string,
  entry: DedupEntry,
): Promise<void> {
  let key: string;
  let ttl: number;

  switch (provider) {
    case 'meta':
      key = metaKey(providerId, identifier, eventName);
      ttl = META_TTL_S;
      break;
    case 'google':
      key = googleKey(providerId, identifier, eventName);
      ttl = GOOGLE_TTL_S;
      break;
    case 'linkedin':
      key = linkedinKey(providerId, identifier, eventName);
      ttl = LINKEDIN_TTL_S;
      break;
    case 'amazon':
      key = amazonKey(providerId, identifier, eventName);
      ttl = AMAZON_TTL_S;
      break;
  }

  await dedupRedis.set(key, JSON.stringify(entry), 'EX', ttl);
}
