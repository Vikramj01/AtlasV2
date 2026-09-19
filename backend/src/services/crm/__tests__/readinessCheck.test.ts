/**
 * readinessCheck unit tests — docs/prd/crm-outcome-integration.md §6.2.
 *
 * Exercises all four verdicts against a mock CrmProvider, since Sprint 2's
 * exit criterion is specifically that the check "correctly distinguishes
 * all four verdicts" — the properties-exist check alone (i.e. skipping the
 * sample step) would pass every failure mode this is designed to catch, so
 * each test asserts the sample step actually ran where relevant.
 */

import { describe, it, expect, vi } from 'vitest';
import { runReadinessCheck } from '../readinessCheck';
import type { CrmProvider, CrmProperty, CrmRecord, DecryptedTokens } from '../providers/types';

const tokens: DecryptedTokens = { access_token: 'tok', expires_at: 0, token_type: 'bearer' };

function makeProvider(overrides: Partial<CrmProvider> = {}): CrmProvider {
  return {
    name: 'hubspot',
    testConnection: vi.fn(),
    listPipelines: vi.fn(),
    listProperties: vi.fn(async (): Promise<CrmProperty[]> => []),
    fetchChangedRecords: () => (async function* (): AsyncIterable<CrmRecord> {})(),
    ...overrides,
  } as unknown as CrmProvider;
}

// fetchChangedRecords is a FUNCTION returning an AsyncIterable, per the
// CrmProvider interface — these helpers build that function, not the
// iterable itself.
function recordsGenerator(records: CrmRecord[]): CrmProvider['fetchChangedRecords'] {
  return () => (async function* (): AsyncIterable<CrmRecord> {
    for (const r of records) yield r;
  })();
}

describe('runReadinessCheck', () => {
  it('returns PROPERTIES_ABSENT when none of the expected properties exist', async () => {
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'unrelated_prop', label: 'Unrelated', type: 'string' }]),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('PROPERTIES_ABSENT');
    expect(result.present_properties).toEqual([]);
    expect(result.sample_size).toBe(0);
  });

  it('returns NOT_OBSERVED when properties exist but the sample fetch errors (permissions)', async () => {
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
      fetchChangedRecords: () => (async function* (): AsyncIterable<CrmRecord> {
        throw new Error('403 insufficient scope');
      })(),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('NOT_OBSERVED');
  });

  it('returns NOT_OBSERVED when properties exist but no records changed in the sampling window', async () => {
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
      fetchChangedRecords: recordsGenerator([]),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('NOT_OBSERVED');
  });

  it('returns PROPERTIES_PRESENT_NO_DATA when the property exists but every sampled record leaves it empty', async () => {
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
      fetchChangedRecords: recordsGenerator([
        { id: '1', object: 'deal', stage_id: 'appointmentscheduled', stage_changed_at: null, properties: { atlas_gclid: null } },
        { id: '2', object: 'deal', stage_id: 'appointmentscheduled', stage_changed_at: null, properties: { atlas_gclid: '' } },
      ]),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('PROPERTIES_PRESENT_NO_DATA');
    expect(result.sample_size).toBe(2);
  });

  it('returns READY when the property exists and at least one sampled record has a value', async () => {
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
      fetchChangedRecords: recordsGenerator([
        { id: '1', object: 'deal', stage_id: 'appointmentscheduled', stage_changed_at: null, properties: { atlas_gclid: null } },
        { id: '2', object: 'deal', stage_id: 'closedwon', stage_changed_at: null, properties: { atlas_gclid: 'real-gclid-value' } },
      ]),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('READY');
    expect(result.sample_size).toBe(2);
  });

  it('caps the sample at 25 records even when the provider yields more', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      object: 'deal' as const,
      stage_id: 'appointmentscheduled',
      stage_changed_at: null,
      properties: { atlas_gclid: null },
    }));
    const provider = makeProvider({
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
      fetchChangedRecords: recordsGenerator(many),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.sample_size).toBe(25);
  });

  it('none of the four verdict messages contain outputLint.ts-banned absolute-absence tokens', async () => {
    const scenarios: Array<Partial<CrmProvider>> = [
      { listProperties: vi.fn(async () => []) },
      {
        listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
        fetchChangedRecords: recordsGenerator([]),
      },
      {
        listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
        fetchChangedRecords: recordsGenerator([{ id: '1', object: 'deal', stage_id: 's', stage_changed_at: null, properties: {} }]),
      },
      {
        listProperties: vi.fn(async () => [{ name: 'atlas_gclid', label: 'GCLID', type: 'string' }]),
        fetchChangedRecords: recordsGenerator([{ id: '1', object: 'deal', stage_id: 's', stage_changed_at: null, properties: { atlas_gclid: 'x' } }]),
      },
    ];
    const bannedTokens = ['not detected', 'missing', 'broken', 'is not installed', 'you have no', 'zero measurement'];

    for (const overrides of scenarios) {
      const result = await runReadinessCheck(makeProvider(overrides), tokens, 'deal', null);
      const lowerMessage = result.message.toLowerCase();
      for (const token of bannedTokens) {
        expect(lowerMessage).not.toContain(token);
      }
    }
  });

  it('checks against the Salesforce-shaped default property names for provider "salesforce" (Sprint 10)', async () => {
    const provider = makeProvider({
      name: 'salesforce',
      listProperties: vi.fn(async () => [{ name: 'atlas_gclid__c', label: 'Atlas GCLID', type: 'string' }]),
      fetchChangedRecords: recordsGenerator([
        { id: '1', object: 'deal', stage_id: 's', stage_changed_at: null, properties: { atlas_gclid__c: 'gclid-value' } },
      ]),
    });

    const result = await runReadinessCheck(provider, tokens, 'deal', null);

    expect(result.verdict).toBe('READY');
    expect(result.present_properties).toContain('atlas_gclid__c');
    // The HubSpot-shaped name must never appear in this provider's expected list.
    expect(result.missing_properties).not.toContain('atlas_gclid');
  });
});
