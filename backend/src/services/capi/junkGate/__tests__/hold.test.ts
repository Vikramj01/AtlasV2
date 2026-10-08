/**
 * Holds, release, reject, timeout and the destination-window clamp (PRD §C.6, §C.11 AC 4, 5, 6, 7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logged: unknown[] = [];
vi.mock('@/utils/logger', () => ({
  default: {
    info: (...a: unknown[]) => logged.push(a), warn: (...a: unknown[]) => logged.push(a),
    error: (...a: unknown[]) => logged.push(a), debug: (...a: unknown[]) => logged.push(a),
  },
}));

// In-memory stand-ins for the persistence layer.
type Hold = { id: string; organization_id: string; client_id: string | null; status: string; expires_at: string | null };
let holds: Map<string, Hold>;
let targets: Array<Record<string, any>>;
let capiRows: Array<Record<string, any>>;
let delivered: Array<{ event: any; identifiers: any[]; provider: string }>;
let configRow: Record<string, unknown> | null;

vi.mock('@/services/database/capiQueries', () => ({
  createCAPIEvent: vi.fn(async (input: Record<string, any>) => { const row = { id: `cap-${capiRows.length + 1}`, ...input }; capiRows.push(row); return row; }),
  getProvider: vi.fn(async (id: string, org: string) => ({
    id, organization_id: org, provider: id === 'p-linkedin' ? 'linkedin' : 'meta', event_mapping: [], identifier_config: { enabled_identifiers: ['email', 'phone', 'fn', 'ln', 'external_id'] },
  })),
}));
vi.mock('@/services/database/junkGateQueries', () => ({
  insertHoldTarget: vi.fn(async (t: Record<string, any>) => { targets.push({ id: `t-${targets.length + 1}`, status: 'pending', ...t }); }),
  listHoldTargets: vi.fn(async (holdId: string) => targets.filter((t) => t.hold_id === holdId)),
  finishHoldTarget: vi.fn(async (id: string, status: string, detail?: unknown) => {
    const t = targets.find((x) => x.id === id)!; t.status = status; t.payload_encrypted = null; t.result_detail = detail;
  }),
  transitionHold: vi.fn(async (id: string, to: string, by: string | null, org?: string) => {
    const h = holds.get(id);
    if (!h || h.status !== 'held' || (org && h.organization_id !== org)) return null;
    h.status = to; return { ...h };
  }),
  getHold: vi.fn(async (org: string, id: string) => { const h = holds.get(id); return h && h.organization_id === org ? h : null; }),
  getHoldById: vi.fn(async (id: string) => holds.get(id) ?? null),
  getJunkGateConfigRow: vi.fn(async () => configRow),
  markCapiEventStatus: vi.fn(async (id: string, status: string) => { const r = capiRows.find((c) => c.id === id); if (r) r.status = status; }),
  listExpiredHoldIds: vi.fn(async (now: string) => [...holds.values()].filter((h) => h.status === 'held' && h.expires_at && h.expires_at <= now).map((h) => h.id)),
}));
vi.mock('../../pipeline', () => ({
  releasePreparedEvent: vi.fn(async (event: any, identifiers: any[], cfg: any) => {
    delivered.push({ event, identifiers, provider: cfg.provider });
    return { event_id: event.event_id, status: cfg.id === 'p-fail' ? 'failed' : 'delivered' };
  }),
}));

import { holdEventTarget, sanitiseForHold, buildHeldPayload } from '../hold';
import { releaseHold, rejectHold } from '../release';
import { processHoldTimeout, sweepExpiredHolds } from '../timeout';
import { clampHoldTimeout, holdCeilingHours, providerWindowDays, SAFETY_MARGIN_HOURS } from '../holdWindows';
import { classifyDelivery, classifyDestination } from '../deliveryClass';
import { META_WEBSITE_INGEST_WINDOW_DAYS, LINKEDIN_INGEST_WINDOW_DAYS, GOOGLE_ADS_INGEST_WINDOW_DAYS } from '@/services/outcomes/ingestWindows';
import type { AtlasEvent, CAPIProviderConfig } from '@/types/capi';

const EMAIL = 'jane.visitor@mailinator.com';
const PHONE = '+44 20 7946 0958';
const IP = '203.0.113.77';

const event = (): AtlasEvent => ({
  event_id: 'evt-1', event_name: 'generate_lead', event_time: 1_790_000_000, event_source_url: 'https://x.test/thanks', action_source: 'website',
  user_data: { email: EMAIL, phone: PHONE, first_name: 'Jane', last_name: 'Visitor', city: 'London', zip: 'N1 9GU', external_id: 'crm-77', gclid: 'G123', client_user_agent: 'UA-X', client_ip_address: IP },
  custom_data: { value: 50, currency: 'GBP' },
  consent_state: { marketing: 'granted', analytics: 'granted' } as AtlasEvent['consent_state'],
});
const cfg = (id: string, provider: 'meta' | 'linkedin' = 'meta'): CAPIProviderConfig => ({
  id, organization_id: 'org-1', provider, event_mapping: [], identifier_config: { enabled_identifiers: ['email', 'phone', 'fn', 'ln', 'external_id'] },
} as unknown as CAPIProviderConfig);

const open = (id = 'hold-1', expires_at: string | null = null): void => {
  holds.set(id, { id, organization_id: 'org-1', client_id: 'client-1', status: 'held', expires_at });
};

beforeEach(() => {
  logged.length = 0;
  holds = new Map(); targets = []; capiRows = []; delivered = []; configRow = null;
});

describe('AC 5 — no raw contact data is stored, logged or queued', () => {
  it('sanitiseForHold removes every raw contact field and replaces external_id with a hash', () => {
    const s = sanitiseForHold(event());
    for (const k of ['email', 'phone', 'first_name', 'last_name', 'city', 'state', 'zip']) expect(s.user_data).not.toHaveProperty(k);
    expect(s.user_data.external_id).toMatch(/^[0-9a-f]{64}$/);
    expect(s.user_data.external_id).not.toBe('crm-77');
    // Delivery still needs these verbatim.
    expect(s.user_data).toMatchObject({ gclid: 'G123', client_user_agent: 'UA-X', client_ip_address: IP });
  });

  it('with no external_id the e-mail is hashed as the stable key (Amazon / Microsoft read external_id ?? email)', () => {
    const e = event(); delete e.user_data.external_id;
    expect(sanitiseForHold(e).user_data.external_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the stored blob is encrypted: neither raw nor hashed contact data appears in the row', async () => {
    open();
    expect(await holdEventTarget('hold-1', event(), cfg('p1'))).toBe('held');
    const row = JSON.stringify(targets[0]);
    for (const pii of [EMAIL, PHONE, 'Jane', 'Visitor', 'London', 'crm-77', IP, 'G123']) expect(row).not.toContain(pii);
    expect(targets[0].payload_encrypted).toMatch(/"ciphertext"/);
  });

  it('the plaintext payload (once decrypted) carries hashed identifiers and no raw e-mail / phone / names', () => {
    const p = buildHeldPayload(event(), cfg('p1'));
    const blob = JSON.stringify(p);
    for (const pii of [EMAIL, PHONE, 'Jane', 'Visitor', 'London', 'crm-77']) expect(blob).not.toContain(pii);
    expect(p.identifiers.find((i) => i.type === 'email')).toMatchObject({ is_hashed: true });
  });

  it('the capi_events row written for a hold carries no identifiers and no PII', async () => {
    open();
    await holdEventTarget('hold-1', event(), cfg('p1'));
    expect(capiRows[0]).toMatchObject({ status: 'junk_held', atlas_event_id: 'evt-1', identifiers_sent: 0 });
    expect(JSON.stringify(capiRows[0])).not.toContain(EMAIL);
  });

  it('release / reject / timeout log no contact data', async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    await releaseHold('hold-1', 'org-1', 'user-1');
    open('hold-2'); await holdEventTarget('hold-2', event(), cfg('p1'));
    await rejectHold('hold-2', 'org-1', 'user-1');
    const blob = JSON.stringify(logged);
    for (const pii of [EMAIL, PHONE, 'Jane', 'Visitor', IP, 'crm-77']) expect(blob).not.toContain(pii);
  });
});

describe('a provider call arriving after the hold was decided follows that decision', () => {
  it('released → send (nothing orphaned); rejected → drop', async () => {
    open('h-rel'); holds.get('h-rel')!.status = 'released';
    open('h-rej'); holds.get('h-rej')!.status = 'auto_dropped';
    expect(await holdEventTarget('h-rel', event(), cfg('p1'))).toBe('send');
    expect(await holdEventTarget('h-rej', event(), cfg('p1'))).toBe('drop');
    expect(targets).toHaveLength(0);
  });
  it('an unknown or observed record is an error, so the pipeline fails open', async () => {
    await expect(holdEventTarget('nope', event(), cfg('p1'))).rejects.toThrow();
    open('h-obs'); holds.get('h-obs')!.status = 'observed';
    await expect(holdEventTarget('h-obs', event(), cfg('p1'))).rejects.toThrow();
  });
});

describe('AC 4 — a released event keeps its identity', () => {
  it('delivers once per destination with the original event_id / event_time / consent and the hold-time identifiers', async () => {
    open();
    await holdEventTarget('hold-1', event(), cfg('p-meta'));
    await holdEventTarget('hold-1', event(), cfg('p-linkedin', 'linkedin'));
    const heldIdentifiers = buildHeldPayload(event(), cfg('p-meta')).identifiers;

    const r = await releaseHold('hold-1', 'org-1', 'user-1');
    expect(r).toMatchObject({ outcome: 'done', status: 'released', delivered: 2, failed: 0 });
    expect(delivered).toHaveLength(2);
    expect(delivered[0].event).toMatchObject({ event_id: 'evt-1', event_time: 1_790_000_000, consent_state: { marketing: 'granted', analytics: 'granted' } });
    expect(delivered[0].identifiers).toEqual(heldIdentifiers);
  });

  it('payloads are nulled on every terminal status, release or failure', async () => {
    open();
    await holdEventTarget('hold-1', event(), cfg('p1'));
    await holdEventTarget('hold-1', event(), cfg('p-fail'));
    const r = await releaseHold('hold-1', 'org-1', 'user-1');
    expect(r).toMatchObject({ delivered: 1, failed: 1 });
    expect(targets.every((t) => t.payload_encrypted === null)).toBe(true);
  });

  it('closes out the held capi_events row as junk_released', async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    await releaseHold('hold-1', 'org-1', 'user-1');
    expect(capiRows[0].status).toBe('junk_released');
  });

  it('reject delivers nothing, nulls the payload and marks the event junk_rejected', async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    const r = await rejectHold('hold-1', 'org-1', 'user-1');
    expect(r).toMatchObject({ outcome: 'done', status: 'rejected' });
    expect(delivered).toHaveLength(0);
    expect(targets[0]).toMatchObject({ status: 'dropped', payload_encrypted: null });
    expect(capiRows[0].status).toBe('junk_rejected');
  });
});

describe('release / reject are exactly-once and org-scoped', () => {
  it('a second release does nothing and never double-delivers', async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    await releaseHold('hold-1', 'org-1', 'user-1');
    expect(await releaseHold('hold-1', 'org-1', 'user-1')).toEqual({ outcome: 'not_held' });
    expect(delivered).toHaveLength(1);
  });

  it('release then reject (or the reverse) loses the second action', async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    await rejectHold('hold-1', 'org-1', 'user-1');
    expect(await releaseHold('hold-1', 'org-1', 'user-1')).toEqual({ outcome: 'not_held' });
    expect(delivered).toHaveLength(0);
  });

  it("another organisation cannot act on this org's hold", async () => {
    open(); await holdEventTarget('hold-1', event(), cfg('p1'));
    expect((await releaseHold('hold-1', 'org-2', 'user-9')).outcome).toBe('not_found');
    expect(delivered).toHaveLength(0);
    expect(holds.get('hold-1')!.status).toBe('held');
  });

  it('an unknown hold is not_found', async () => {
    expect((await rejectHold('nope', 'org-1', 'u')).outcome).toBe('not_found');
  });
});

describe('timeout (default release; drop on request)', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();

  it('releases an unreviewed hold by default (fails open) as auto_released', async () => {
    open('hold-1', past); await holdEventTarget('hold-1', event(), cfg('p1'));
    const r = await processHoldTimeout('hold-1');
    expect(r).toMatchObject({ outcome: 'done', status: 'auto_released' });
    expect(delivered).toHaveLength(1);
  });

  it('drops it as auto_dropped when the client config says drop — read at expiry, not at hold time', async () => {
    open('hold-1', past); await holdEventTarget('hold-1', event(), cfg('p1'));
    configRow = { mode: 'enforce', timeout_action: 'drop' };
    expect(await processHoldTimeout('hold-1')).toMatchObject({ outcome: 'done', status: 'auto_dropped' });
    expect(delivered).toHaveLength(0);
    expect(targets[0].payload_encrypted).toBeNull();
  });

  it('does nothing for a hold that is not yet due, or is already decided', async () => {
    open('hold-1', future); await holdEventTarget('hold-1', event(), cfg('p1'));
    expect(await processHoldTimeout('hold-1')).toEqual({ outcome: 'not_due' });
    await releaseHold('hold-1', 'org-1', 'u');
    expect(await processHoldTimeout('hold-1')).toEqual({ outcome: 'not_held' });
  });

  it('the sweep resolves expired holds only', async () => {
    open('old', past); await holdEventTarget('old', event(), cfg('p1'));
    open('fresh', future); await holdEventTarget('fresh', event(), cfg('p1'));
    expect(await sweepExpiredHolds()).toBe(1);
    expect(holds.get('old')!.status).toBe('auto_released');
    expect(holds.get('fresh')!.status).toBe('held');
  });
});

describe('AC 6 — timeout is clamped to the shortest destination window minus the margin', () => {
  it('uses the sourced windows', () => {
    expect(providerWindowDays('meta')).toBe(META_WEBSITE_INGEST_WINDOW_DAYS);
    expect(providerWindowDays('linkedin')).toBe(LINKEDIN_INGEST_WINDOW_DAYS);
    expect(providerWindowDays('google')).toBe(Math.min(...Object.values(GOOGLE_ADS_INGEST_WINDOW_DAYS)));
    expect(META_WEBSITE_INGEST_WINDOW_DAYS).toBe(7);
  });

  it('a provider with no sourced window gets the conservative default, never a larger figure', () => {
    expect(providerWindowDays('tiktok')).toBeLessThanOrEqual(7);
    expect(providerWindowDays('openai')).toBeLessThanOrEqual(7);
  });

  it('Meta alone: ceiling = 7d − 12h = 156h; a longer request is clamped and flagged', () => {
    expect(holdCeilingHours(['meta'])).toBe(7 * 24 - SAFETY_MARGIN_HOURS);
    expect(clampHoldTimeout(200, ['meta'])).toEqual({ hours: 156, clamped: true, ceiling_hours: 156 });
  });

  it('the SHORTEST window among all bound providers decides', () => {
    expect(holdCeilingHours(['linkedin', 'google', 'meta'])).toBe(156);
    expect(holdCeilingHours(['linkedin'])).toBe(LINKEDIN_INGEST_WINDOW_DAYS * 24 - 12);
  });

  it('a request within the ceiling is untouched; the floor is one hour', () => {
    expect(clampHoldTimeout(24, ['meta'])).toEqual({ hours: 24, clamped: false, ceiling_hours: 156 });
    expect(clampHoldTimeout(0, ['meta']).hours).toBe(1);
  });

  it('the product maximum (72h) always fits inside the shortest known window', () => {
    for (const p of ['meta', 'google', 'linkedin', 'tiktok', 'amazon', 'microsoft', 'openai'] as const) {
      expect(holdCeilingHours([p])).toBeGreaterThanOrEqual(72);
    }
  });
});

describe('AC 7 — delivery class (server_only vs hybrid)', () => {
  it('LinkedIn is server-only; browser-pixel platforms are hybrid', () => {
    expect(classifyDestination('linkedin')).toBe('server_only');
    for (const p of ['meta', 'google', 'tiktok', 'microsoft', 'amazon', 'openai'] as const) expect(classifyDestination(p)).toBe('hybrid');
  });
  it('any hybrid destination makes the whole event hybrid; none defaults to hybrid', () => {
    expect(classifyDelivery(['linkedin'])).toBe('server_only');
    expect(classifyDelivery(['linkedin', 'meta'])).toBe('hybrid');
    expect(classifyDelivery([])).toBe('hybrid');
  });
});
