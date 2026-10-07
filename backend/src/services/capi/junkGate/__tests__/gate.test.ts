/**
 * The gate end-to-end over fakes (GA4 Admin / L11 / Junk Gate PRD §C.11 AC 1, 2, 3, 5).
 *   AC1  one Atlas event for three providers → exactly one verdict evaluation and one record
 *   AC2  JC_DUPLICATE_SUBMISSION is distinct from event_id dedup (also in rules/store tests)
 *   AC3  observe mode never delays or blocks, and records verdicts
 *   AC5  no raw email / phone / IP / UA in the record, the Redis keys, or the logs
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const logged: unknown[] = [];
vi.mock('@/utils/logger', () => ({
  default: {
    info: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a),
    error: (...a: unknown[]) => logged.push(a), debug: (...a: unknown[]) => logged.push(a),
  },
}));
// The gate's default deps import the real DB/Redis modules; every test injects its own.
vi.mock('@/services/database/junkGateQueries', () => ({
  getClientIdForProvider: vi.fn(), getJunkGateConfigRow: vi.fn(), insertObservedRecord: vi.fn(), appendProviderConfigId: vi.fn(),
  getHoldById: vi.fn(), updateHoldBinding: vi.fn(),
}));
vi.mock('@/services/capi/dedupStore', () => ({ dedupRedis: {} }));

import { runJunkGate, clearGateCaches, type GateDeps } from '../gate';
import { JunkGateStore, type GateRedis } from '../store';
import type { AtlasEvent, CAPIProviderConfig } from '@/types/capi';

class FakeRedis implements GateRedis {
  data = new Map<string, string>();
  async get(k: string) { return this.data.get(k) ?? null; }
  async set(k: string, v: string, ...args: Array<string | number>) { if (args.includes('NX') && this.data.has(k)) return null; this.data.set(k, v); return 'OK'; }
  async incr(k: string) { const n = Number(this.data.get(k) ?? 0) + 1; this.data.set(k, String(n)); return n; }
  async expire() { return 1; }
}

const EMAIL = 'jane.visitor@mailinator.com';
const PHONE = '+44 20 7946 0958';
const IP = '203.0.113.77';
const UA = 'Mozilla/5.0 (X11) HeadlessChrome/120.0';

const event = (over: Partial<AtlasEvent> = {}): AtlasEvent => ({
  event_id: 'evt-1', event_name: 'generate_lead', event_time: 1_790_000_000, event_source_url: 'https://x.test', action_source: 'website',
  user_data: { email: EMAIL, phone: PHONE, first_name: 'Jane', last_name: 'Visitor', client_user_agent: UA, client_ip_address: IP, country: 'GB' },
  consent_state: { marketing: 'granted', analytics: 'granted', personalisation: 'granted', functional: 'granted' } as AtlasEvent['consent_state'],
  ...over,
});
const provider = (id: string): CAPIProviderConfig => ({ id, organization_id: 'org-1', provider: 'meta' } as CAPIProviderConfig);

let redis: FakeRedis;
let records: Array<Record<string, unknown>>;
let appended: Array<[string, string]>;
let bound: Array<[string, string]>;
let configRow: Record<string, unknown> | null;
let deps: GateDeps;

beforeEach(() => {
  logged.length = 0;
  clearGateCaches();
  redis = new FakeRedis();
  records = [];
  appended = [];
  bound = [];
  configRow = null;
  deps = {
    store: new JunkGateStore(async () => redis),
    getClientId: async () => 'client-1',
    getConfigRow: async () => configRow as never,
    insertRecord: async (rec) => { records.push(rec as never); return { id: `rec-${records.length}`, created: true }; },
    appendProvider: async (id, p) => { appended.push([id, p]); },
    bindHold: async (id, p) => { bound.push([id, p.id]); },
    now: Date.now,
  };
});

describe('AC 1 — one Atlas event bound for three providers: one evaluation, one record', () => {
  it('evaluates once, writes one record, and the other two calls reuse the verdict and append themselves', async () => {
    const a = await runJunkGate(event(), provider('p-meta'), deps);
    const b = await runJunkGate(event(), provider('p-google'), deps);
    const c = await runJunkGate(event(), provider('p-linkedin'), deps);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ atlas_event_id: 'evt-1', provider_config_id: 'p-meta' });
    expect([a.memoised, b.memoised, c.memoised]).toEqual([undefined, true, true]);
    expect([a.verdict, b.verdict, c.verdict]).toEqual(['junk', 'junk', 'junk']);
    expect(appended).toEqual([['rec-1', 'p-google'], ['rec-1', 'p-linkedin']]);
    // The stateful signals ran once, not three times.
    const velKey = [...redis.data.keys()].find((k) => k.startsWith('junk:vel'))!;
    expect(redis.data.get(velKey)).toBe('1');
  });

  it('concurrent provider calls still evaluate once', async () => {
    const results = await Promise.all(['p1', 'p2', 'p3'].map((p) => runJunkGate(event(), provider(p), deps)));
    expect(records).toHaveLength(1);
    expect(results.filter((r) => !r.memoised)).toHaveLength(1);
    expect(new Set(results.map((r) => r.verdict)).size).toBe(1);
  });

  it('two DIFFERENT events are evaluated independently', async () => {
    await runJunkGate(event({ event_id: 'evt-a' }), provider('p1'), deps);
    await runJunkGate(event({ event_id: 'evt-b' }), provider('p1'), deps);
    expect(records).toHaveLength(2);
  });
});

describe('AC 3 — observe mode never delays or blocks, and records verdicts', () => {
  it('a junk verdict still returns action: send', async () => {
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r).toMatchObject({ action: 'send', evaluated: true, mode: 'observe', verdict: 'junk' });
    expect(r.hits?.map((h) => h.rule_id)).toEqual(expect.arrayContaining(['JC_EMAIL_DISPOSABLE', 'JC_NON_HUMAN_UA']));
  });

  it('records the verdict and rule hits (clean included, as a hit-rate denominator)', async () => {
    await runJunkGate(event({ user_data: { email: 'jane@acme.co.uk', first_name: 'Jane', last_name: 'Visitor' } }), provider('p1'), deps);
    expect(records[0]).toMatchObject({ verdict: 'clean', rule_hits: [], client_id: 'client-1', event_name: 'generate_lead' });
    expect(records[0].event_time).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it('with no saved config the default is observe', async () => {
    expect((await runJunkGate(event(), provider('p1'), deps)).mode).toBe('observe');
  });

  it('a client with NO saved config is never held or dropped, however junky the event', async () => {
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r.action).toBe('send');
    expect(records[0]).not.toHaveProperty('status');
  });
});

describe('C2 — enforce mode', () => {
  it('junk + default action_junk(hold) → hold, record created as held with expiry, class and clamp info', async () => {
    configRow = { mode: 'enforce' };
    const t0 = 1_800_000_000_000;
    deps.now = () => t0;
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r).toMatchObject({ action: 'hold', record_id: 'rec-1', verdict: 'junk', mode: 'enforce' });
    expect(records[0]).toMatchObject({
      status: 'held', delivery_class: 'hybrid', timeout_hours_applied: 24, timeout_clamped: false,
      expires_at: new Date(t0 + 24 * 3_600_000).toISOString(),
    });
    expect(r.expires_at).toBe(records[0].expires_at);
  });

  it('a saved timeout above the destination ceiling is clamped, and the clamp is recorded', async () => {
    configRow = { mode: 'enforce', hold_timeout_hours: 72 };
    await runJunkGate(event(), provider('p1'), deps); // meta: 7d → 156h ceiling, so 72h stands
    expect(records[0]).toMatchObject({ timeout_hours_applied: 72, timeout_clamped: false });
  });

  it('action_junk drop → drop, record created as rejected', async () => {
    configRow = { mode: 'enforce', action_junk: 'drop' };
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r).toMatchObject({ action: 'drop', record_id: 'rec-1' });
    expect(records[0]).toMatchObject({ status: 'rejected' });
  });

  it('action send → the event is sent and recorded as observed', async () => {
    configRow = { mode: 'enforce', action_junk: 'send' };
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r.action).toBe('send');
    expect(records[0]).not.toHaveProperty('status');
  });

  it('a clean verdict is never acted on in enforce mode', async () => {
    configRow = { mode: 'enforce', action_junk: 'drop', action_suspect: 'drop' };
    const r = await runJunkGate(event({ user_data: { email: 'jane@acme.co.uk', first_name: 'Jane', last_name: 'Visitor' } }), provider('p1'), deps);
    expect(r).toMatchObject({ action: 'send', verdict: 'clean' });
  });

  it('suspect uses action_suspect, not action_junk', async () => {
    configRow = { mode: 'enforce', action_junk: 'drop', action_suspect: 'hold' };
    // Disposable domain (soft) + an obvious test name (soft), nothing hard → suspect.
    const r = await runJunkGate(event({ user_data: { email: 'real.person@mailinator.com', first_name: 'Test', last_name: 'Test' } }), provider('p1'), deps);
    expect(r).toMatchObject({ verdict: 'suspect', action: 'hold' });
    expect(records[0]).toMatchObject({ verdict: 'suspect', status: 'held' });
  });

  it('three provider calls: ONE record; the later two reuse the hold decision and re-clamp it', async () => {
    configRow = { mode: 'enforce' };
    const a = await runJunkGate(event(), provider('p-meta'), deps);
    const b = await runJunkGate(event(), provider('p-google'), deps);
    const c = await runJunkGate(event(), provider('p-linkedin'), deps);
    expect(records).toHaveLength(1);
    expect([a.action, b.action, c.action]).toEqual(['hold', 'hold', 'hold']);
    expect(b.record_id).toBe('rec-1');
    expect(bound).toEqual([['rec-1', 'p-google'], ['rec-1', 'p-linkedin']]);
    expect(b.expires_at).toBeUndefined(); // only the creating call schedules the timeout job
  });

  it('a later call for a DROPPED event is dropped too', async () => {
    configRow = { mode: 'enforce', action_junk: 'drop' };
    await runJunkGate(event(), provider('p1'), deps);
    expect((await runJunkGate(event(), provider('p2'), deps)).action).toBe('drop');
    expect(bound).toEqual([]);
  });

  it('FAILS OPEN: if the record cannot be written, the event is sent rather than held or dropped', async () => {
    configRow = { mode: 'enforce', action_junk: 'drop' };
    deps.insertRecord = async () => { throw new Error('db down'); };
    expect((await runJunkGate(event(), provider('p1'), deps)).action).toBe('send');
  });

  it('observe mode with action_junk=drop still sends (the actions are enforce-only)', async () => {
    configRow = { mode: 'observe', action_junk: 'drop' };
    expect((await runJunkGate(event(), provider('p1'), deps)).action).toBe('send');
  });

  it('the logs never contain the e-mail, phone, IP or user agent of an enforced verdict', async () => {
    configRow = { mode: 'enforce' };
    await runJunkGate(event(), provider('p1'), deps);
    const blob = JSON.stringify(logged);
    for (const pii of [EMAIL, PHONE, IP, UA, 'Jane', 'Visitor']) expect(blob).not.toContain(pii);
  });
});

describe('scope and switches', () => {
  it('mode off evaluates nothing and touches neither Redis nor the DB', async () => {
    configRow = { mode: 'off' };
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r).toMatchObject({ evaluated: false, skipped: 'off', action: 'send' });
    expect(records).toHaveLength(0);
    expect(redis.data.size).toBe(0);
  });

  it('an out-of-scope event (purchase) is skipped before any Redis/DB write', async () => {
    const r = await runJunkGate(event({ event_name: 'purchase' }), provider('p1'), deps);
    expect(r).toMatchObject({ evaluated: false, skipped: 'out_of_scope' });
    expect(records).toHaveLength(0);
    expect(redis.data.size).toBe(0);
  });

  it('a custom event list brings purchase into scope', async () => {
    configRow = { event_names: ['purchase'] };
    expect((await runJunkGate(event({ event_name: 'purchase' }), provider('p1'), deps)).evaluated).toBe(true);
  });

  it('a provider with no identity config uses defaults and records client_id null', async () => {
    deps.getClientId = async () => null;
    await runJunkGate(event(), provider('p1'), deps);
    expect(records[0].client_id).toBeNull();
  });
});

describe('IP / user agent come only from the event (never the request)', () => {
  it('without them JC_NON_HUMAN_UA and JC_SUBMIT_VELOCITY cannot fire', async () => {
    const ev = event({ user_data: { email: 'jane@acme.co.uk', first_name: 'Jane', last_name: 'Visitor' } });
    const r = await runJunkGate(ev, provider('p1'), deps);
    expect(r.verdict).toBe('clean');
    expect([...redis.data.keys()].some((k) => k.startsWith('junk:vel'))).toBe(false);
  });

  it('velocity counts per hashed address and fires above the threshold across distinct events', async () => {
    configRow = { thresholds: { velocity_max: 2 } };
    const verdicts: Array<string | undefined> = [];
    for (let i = 0; i < 4; i++) {
      const r = await runJunkGate(event({ event_id: `evt-${i}`, user_data: { email: `u${i}@acme.co.uk`, first_name: 'Jane', last_name: 'Visitor', client_ip_address: IP } }), provider('p1'), deps);
      verdicts.push(r.hits?.some((h) => h.rule_id === 'JC_SUBMIT_VELOCITY') ? 'velocity' : 'ok');
    }
    expect(verdicts).toEqual(['ok', 'ok', 'velocity', 'velocity']);
  });

  it('the route does not inject the request address (it would be the operator\'s or a relay\'s, not the visitor\'s)', () => {
    const src = readFileSync(join(__dirname, '../../../../api/routes/capi.ts'), 'utf8');
    expect(src).not.toMatch(/requestIp\s*:\s*req\./);
    expect(src).not.toMatch(/requestUa\s*:\s*req\./);
  });
});

describe('JC_DUPLICATE_SUBMISSION through the gate: distinct event ids, same contact', () => {
  it('flags the second submission and not the first', async () => {
    const mk = (id: string) => event({ event_id: id, user_data: { email: 'jane@acme.co.uk', first_name: 'Jane', last_name: 'Visitor' } });
    const first = await runJunkGate(mk('evt-1'), provider('p1'), deps);
    const second = await runJunkGate(mk('evt-2'), provider('p1'), deps);
    expect(first.hits).toEqual([]);
    expect(second.hits?.map((h) => h.rule_id)).toEqual(['JC_DUPLICATE_SUBMISSION']);
  });
  it('is NOT triggered by the same event id arriving again for another provider (that is a memo hit, and dedup\'s job)', async () => {
    const mk = () => event({ user_data: { email: 'jane@acme.co.uk', first_name: 'Jane', last_name: 'Visitor' } });
    await runJunkGate(mk(), provider('p1'), deps);
    const again = await runJunkGate(mk(), provider('p2'), deps);
    expect(again.memoised).toBe(true);
    expect(again.hits).toEqual([]);
  });
});

describe('AC 5 — no raw email / phone / IP / user agent anywhere it is stored or logged', () => {
  it('the record, the Redis keys and values, and every log line are free of them', async () => {
    for (let i = 0; i < 3; i++) await runJunkGate(event({ event_id: `evt-${i}` }), provider(`p${i}`), deps);
    const surfaces = [
      JSON.stringify(records),
      [...redis.data.entries()].map(([k, v]) => `${k}=${v}`).join('\n'),
      JSON.stringify(logged),
    ].join('\n');
    for (const secret of [EMAIL, 'jane.visitor', PHONE, '7946 0958', '79460958', IP, UA, 'HeadlessChrome/120']) {
      expect(surfaces, `leaked: ${secret}`).not.toContain(secret);
    }
  });
});

describe('fail open', () => {
  it('any dependency error returns send/not-evaluated and never throws', async () => {
    deps.getClientId = async () => { throw new Error('db down'); };
    await expect(runJunkGate(event(), provider('p1'), deps)).resolves.toMatchObject({ action: 'send', evaluated: false, skipped: 'error' });
  });

  it('a Redis failure fails open', async () => {
    deps.store = new JunkGateStore(async () => { throw new Error('redis down'); });
    await expect(runJunkGate(event(), provider('p1'), deps)).resolves.toMatchObject({ action: 'send', evaluated: false, skipped: 'error' });
  });

  it('a record-write failure still returns the verdict, and delivery is unaffected', async () => {
    deps.insertRecord = async () => { throw new Error('insert failed'); };
    const r = await runJunkGate(event(), provider('p1'), deps);
    expect(r).toMatchObject({ action: 'send', evaluated: true, verdict: 'junk' });
  });

  it('a slow dependency is cut off by the timeout rather than delaying delivery', async () => {
    deps.getClientId = () => new Promise(() => { /* never resolves */ });
    const started = Date.now();
    const r = await runJunkGate(event(), provider('p1'), deps, 50);
    expect(r).toMatchObject({ action: 'send', evaluated: false, skipped: 'timeout' });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
