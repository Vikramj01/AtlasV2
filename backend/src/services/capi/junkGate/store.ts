/**
 * Redis-backed signals and per-event verdict memo for the junk gate (GA4 Admin / L11 / Junk Gate
 * PRD §C.4, §C.5a).
 *
 * WHY A MEMO: `/api/capi/process` takes ONE provider per call and the browser calls it once per
 * provider, so one Atlas event reaches the pipeline N times (Sprint 0.3). The gate must evaluate
 * an event ONCE: the first call claims `junk:verdict:{org}:{atlas_event_id}` with SET NX, later
 * calls read the verdict back. The TTL (7 days) is longer than the longest hold window (72h) plus
 * the 12-hour safety margin, so a verdict can never expire while its hold is still open.
 *
 * Nothing stored here is PII: keys carry SHA-256 hashes, values carry event ids, counts and the
 * verdict. Redis is reached through a lazy dynamic import — `dedupStore` opens a connection at
 * module load (the same reason `api/routes/gtm.ts` imports it dynamically).
 */
import { createHash } from 'crypto';
import type { JunkVerdict, RuleHit } from './types';

export const MEMO_TTL_SECONDS = 7 * 24 * 60 * 60;
const PENDING = '__pending__';
const PENDING_TTL_SECONDS = 30;
const PENDING_POLL_MS = 100;
const PENDING_MAX_WAIT_MS = 1500;

export const BEACON_TTL_SECONDS = 24 * 60 * 60;

export interface BeaconSignals {
  ms_to_submit?: number;
  honeypot_filled?: boolean;
}

export interface GateRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface VerdictMemo {
  verdict: JunkVerdict;
  hits: RuleHit[];
  /** conversion_holds row id, so later provider calls append themselves to it. */
  record_id: string | null;
  /** What the gate decided for this event (C2). Absent in C1-era memos = 'send'. */
  action?: 'send' | 'hold' | 'drop';
}

export type ClaimResult =
  | { kind: 'won' }
  | { kind: 'memo'; memo: VerdictMemo }
  | { kind: 'pending_timeout' };

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const normaliseEmailForHash = (v: string): string => v.trim().toLowerCase();
export const normalisePhoneForHash = (v: string): string => v.replace(/\D/g, '');

export class JunkGateStore {
  constructor(private readonly getRedis: () => Promise<GateRedis>) {}

  private verdictKey(orgId: string, eventId: string): string {
    return `junk:verdict:${orgId}:${eventId}`;
  }

  /** First caller wins the right to evaluate; everyone else gets the winner's verdict (waiting briefly if it is still evaluating). */
  async claim(orgId: string, eventId: string): Promise<ClaimResult> {
    const redis = await this.getRedis();
    const key = this.verdictKey(orgId, eventId);
    const won = await redis.set(key, PENDING, 'EX', PENDING_TTL_SECONDS, 'NX');
    if (won === 'OK') return { kind: 'won' };

    const deadline = Date.now() + PENDING_MAX_WAIT_MS;
    for (;;) {
      const raw = await redis.get(key);
      if (raw && raw !== PENDING) return { kind: 'memo', memo: JSON.parse(raw) as VerdictMemo };
      if (raw === null) return { kind: 'won' }; // the winner's claim expired without a result: take over
      if (Date.now() >= deadline) return { kind: 'pending_timeout' };
      await new Promise((r) => setTimeout(r, PENDING_POLL_MS));
    }
  }

  /** Browser-side signals the GTM Signal Tag beacons ahead of the server event (C3). Booleans / counts only. */
  async saveBeaconSignals(orgId: string, eventId: string, signals: BeaconSignals): Promise<void> {
    const redis = await this.getRedis();
    await redis.set(`junk:beacon:${orgId}:${eventId}`, JSON.stringify(signals), 'EX', BEACON_TTL_SECONDS);
  }

  /** null when the beacon has not arrived (or expired): the dependent rules simply cannot fire. */
  async getBeaconSignals(orgId: string, eventId: string): Promise<BeaconSignals | null> {
    const redis = await this.getRedis();
    const raw = await redis.get(`junk:beacon:${orgId}:${eventId}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as BeaconSignals; } catch { return null; }
  }

  async saveMemo(orgId: string, eventId: string, memo: VerdictMemo): Promise<void> {
    const redis = await this.getRedis();
    await redis.set(this.verdictKey(orgId, eventId), JSON.stringify(memo), 'EX', MEMO_TTL_SECONDS);
  }

  /**
   * Same hashed contact + same event under a DIFFERENT event id within the window. This is NOT
   * dedup (which matches the same event_id). Returns the earlier event's id, or null.
   */
  async findDuplicate(scope: string, eventName: string, contactHash: string, eventId: string, windowMinutes: number): Promise<string | null> {
    const redis = await this.getRedis();
    const key = `junk:dup:${scope}:${eventName.toLowerCase()}:${contactHash}`;
    const ttl = Math.max(60, Math.round(windowMinutes * 60));
    const claimed = await redis.set(key, eventId, 'EX', ttl, 'NX');
    if (claimed === 'OK') return null;
    const earlier = await redis.get(key);
    return earlier && earlier !== eventId ? earlier : null;
  }

  /** Submissions of this event from this (hashed) address in the window, including this one. */
  async countVelocity(scope: string, eventName: string, ipHash: string, windowMinutes: number): Promise<number> {
    const redis = await this.getRedis();
    const key = `junk:vel:${scope}:${eventName.toLowerCase()}:${ipHash}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, Math.max(60, Math.round(windowMinutes * 60)));
    return n;
  }
}

/** The production store: Redis through the lazily-imported dedup connection. */
export function createDefaultStore(): JunkGateStore {
  return new JunkGateStore(async () => {
    const { dedupRedis } = await import('@/services/capi/dedupStore');
    return dedupRedis as unknown as GateRedis;
  });
}
