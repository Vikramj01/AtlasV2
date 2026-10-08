import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JunkGateStore, MEMO_TTL_SECONDS, sha256, type GateRedis, type VerdictMemo } from '../store';

/** Minimal Redis fake: strings with NX/EX semantics, incr/expire, and recorded TTLs. */
class FakeRedis implements GateRedis {
  data = new Map<string, string>();
  ttls = new Map<string, number>();
  async get(k: string) { return this.data.get(k) ?? null; }
  async set(k: string, v: string, ...args: Array<string | number>) {
    const nx = args.includes('NX');
    const exIdx = args.indexOf('EX');
    if (nx && this.data.has(k)) return null;
    this.data.set(k, v);
    if (exIdx >= 0) this.ttls.set(k, Number(args[exIdx + 1]));
    return 'OK';
  }
  async incr(k: string) { const n = Number(this.data.get(k) ?? 0) + 1; this.data.set(k, String(n)); return n; }
  async expire(k: string, s: number) { this.ttls.set(k, s); return 1; }
}

let redis: FakeRedis;
let store: JunkGateStore;
beforeEach(() => { redis = new FakeRedis(); store = new JunkGateStore(async () => redis); });

const memo = (over: Partial<VerdictMemo> = {}): VerdictMemo => ({ verdict: 'suspect', hits: [], record_id: 'rec-1', ...over });

describe('verdict memo (one evaluation per Atlas event)', () => {
  it('the first caller wins; a later caller gets the winner\'s saved verdict', async () => {
    expect((await store.claim('org', 'evt-1')).kind).toBe('won');
    await store.saveMemo('org', 'evt-1', memo());
    const second = await store.claim('org', 'evt-1');
    expect(second.kind).toBe('memo');
    if (second.kind === 'memo') expect(second.memo.record_id).toBe('rec-1');
  });

  it('memos are scoped per organisation', async () => {
    await store.claim('org-a', 'evt-1');
    await store.saveMemo('org-a', 'evt-1', memo());
    expect((await store.claim('org-b', 'evt-1')).kind).toBe('won');
  });

  it('the saved memo outlives the longest hold window (72h) plus the 12h safety margin', async () => {
    await store.claim('org', 'evt-1');
    await store.saveMemo('org', 'evt-1', memo());
    const ttl = redis.ttls.get('junk:verdict:org:evt-1')!;
    expect(ttl).toBe(MEMO_TTL_SECONDS);
    expect(ttl).toBeGreaterThan((72 + 12) * 3600);
  });

  it('a caller arriving while the winner is still evaluating waits for its verdict', async () => {
    await store.claim('org', 'evt-1');
    const waiting = store.claim('org', 'evt-1');
    setTimeout(() => { void store.saveMemo('org', 'evt-1', memo({ verdict: 'junk' })); }, 150);
    const r = await waiting;
    expect(r.kind).toBe('memo');
    if (r.kind === 'memo') expect(r.memo.verdict).toBe('junk');
  });

  it('gives up after the wait budget if the winner never finishes (caller fails open)', async () => {
    vi.useFakeTimers();
    await store.claim('org', 'evt-1');
    const waiting = store.claim('org', 'evt-1');
    await vi.advanceTimersByTimeAsync(2000);
    expect((await waiting).kind).toBe('pending_timeout');
    vi.useRealTimers();
  });

  it('takes over when the winner\'s claim expired without a result', async () => {
    await store.claim('org', 'evt-1');
    redis.data.delete('junk:verdict:org:evt-1');
    expect((await store.claim('org', 'evt-1')).kind).toBe('won');
  });
});

describe('findDuplicate — same contact + event under a DIFFERENT event id (not event_id dedup)', () => {
  it('first sight is not a duplicate; a different event id inside the window is', async () => {
    expect(await store.findDuplicate('s', 'Lead', 'hash', 'evt-1', 10)).toBeNull();
    expect(await store.findDuplicate('s', 'Lead', 'hash', 'evt-2', 10)).toBe('evt-1');
  });
  it('the SAME event id re-evaluated is not a duplicate of itself', async () => {
    await store.findDuplicate('s', 'Lead', 'hash', 'evt-1', 10);
    expect(await store.findDuplicate('s', 'Lead', 'hash', 'evt-1', 10)).toBeNull();
  });
  it('a different event name, contact or scope never collides', async () => {
    await store.findDuplicate('s', 'Lead', 'hash', 'evt-1', 10);
    expect(await store.findDuplicate('s', 'Signup', 'hash', 'evt-2', 10)).toBeNull();
    expect(await store.findDuplicate('s', 'Lead', 'other', 'evt-3', 10)).toBeNull();
    expect(await store.findDuplicate('t', 'Lead', 'hash', 'evt-4', 10)).toBeNull();
  });
  it('expires with the configured window and never stores the contact itself', async () => {
    await store.findDuplicate('s', 'Lead', sha256('jane@example.com'), 'evt-1', 10);
    const [key] = [...redis.data.keys()];
    expect(redis.ttls.get(key)).toBe(600);
    expect(key).not.toContain('jane');
    expect(key).not.toContain('example.com');
  });
});

describe('countVelocity', () => {
  it('counts per hashed address and event, and sets the window on the first hit only', async () => {
    expect(await store.countVelocity('s', 'Lead', 'iphash', 60)).toBe(1);
    expect(await store.countVelocity('s', 'Lead', 'iphash', 60)).toBe(2);
    expect(await store.countVelocity('s', 'Lead', 'otheriphash', 60)).toBe(1);
    expect(redis.ttls.get('junk:vel:s:lead:iphash')).toBe(3600);
  });
  it('keys contain a hash, never the address', async () => {
    await store.countVelocity('s', 'Lead', sha256('203.0.113.9'), 60);
    expect([...redis.data.keys()].join(' ')).not.toContain('203.0.113.9');
  });
});
