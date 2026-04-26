import Redis from 'ioredis';
import { env } from '@/config/env';

const META_TTL_S   = 48 * 60 * 60;       // 48 hours — Meta dedup window
const GOOGLE_TTL_S = 90 * 24 * 60 * 60;  // 90 days  — Google dedup window

function buildRedisClient(): Redis {
  const parsed = new URL(env.REDIS_URL);
  const opts: Record<string, unknown> = {
    host:      parsed.hostname,
    port:      Number(parsed.port) || 6379,
    password:  parsed.password || undefined,
    username:  parsed.username && parsed.username !== 'default' ? parsed.username : undefined,
    lazyConnect: true,
  };
  if (parsed.protocol === 'rediss:') {
    opts['tls'] = { rejectUnauthorized: false };
  }
  return new Redis(opts as ConstructorParameters<typeof Redis>[0]);
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

export async function setDedupEntry(
  provider: 'meta' | 'google',
  providerId: string,
  identifier: string,
  eventName: string,
  entry: DedupEntry,
): Promise<void> {
  const key = provider === 'meta'
    ? metaKey(providerId, identifier, eventName)
    : googleKey(providerId, identifier, eventName);
  const ttl = provider === 'meta' ? META_TTL_S : GOOGLE_TTL_S;
  await dedupRedis.set(key, JSON.stringify(entry), 'EX', ttl);
}
