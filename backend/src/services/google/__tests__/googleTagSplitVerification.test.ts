import { describe, it, expect } from 'vitest';
import { evaluateSplitVerification } from '../googleTagSplitVerification';
import { buildSplitGuidance } from '../../ihc/googleTagSplitGuidance';
import type { GTMContainerSnapshot, GTMTag, GTMTrigger } from '@/types/audit';
import type { TopologyRow } from '../googleTagTopology';

const DEPLOYED = new Date('2026-10-01T10:00:00Z');
const BEFORE = '2026-10-01T09:00:00Z';
const AFTER = '2026-10-01T11:00:00Z';

const allPages: GTMTrigger = { triggerId: '1', name: 'All Pages', type: 'PAGEVIEW' };
const googtag = (id: string): GTMTag => ({
  tagId: id, name: id, type: 'googtag', firingTriggerId: ['1'], parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }],
});
const conv: GTMTag = { tagId: 'c', name: 'conv', type: 'awct', firingTriggerId: ['1'], parameter: [] };
const snap = (tags: GTMTag[], at: string) => ({
  snapshot_at: at,
  container: { container_id: 'c', fetched_at: at, source: 'gtm_api', tags, triggers: [allPages], variables: [], built_in_variables: [], consent_default_tag: null } as GTMContainerSnapshot,
});
const row = (ids: string[], at: string): TopologyRow & { observed_at: string } => ({
  google_tag_id: ids[0], primary_destination_id: ids[0], destination_ids: ids, source: 'operator_declared', declaration_source: 'CLIENT_CONFIRMED', observed_at: at,
});

describe('evaluateSplitVerification (AC 13)', () => {
  const base = { planStartedAt: DEPLOYED, secondaryDomains: [] as string[] };

  it('verifies only with a fresh SPLIT observation, a fresh snapshot, and the Ads tag present', () => {
    const r = evaluateSplitVerification({
      ...base,
      snapshot: snap([googtag('G-1'), googtag('AW-1'), conv], AFTER),
      topologyRows: [row(['G-1'], AFTER), row(['AW-1'], AFTER)],
    });
    expect(r.verified).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('the draft deploy alone is never verification: no fresh observation', () => {
    const r = evaluateSplitVerification({ ...base, snapshot: snap([googtag('G-1'), googtag('AW-1'), conv], AFTER), topologyRows: [row(['G-1'], BEFORE)] });
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('No Google tag topology has been observed since');
  });

  it('a stale container snapshot (before the deploy) cannot verify', () => {
    const r = evaluateSplitVerification({ ...base, snapshot: snap([googtag('G-1'), googtag('AW-1'), conv], BEFORE), topologyRows: [row(['G-1'], AFTER)] });
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('No container snapshot has been taken since');
  });

  it('a still-COMBINED observation fails with the verdict named', () => {
    const r = evaluateSplitVerification({ ...base, snapshot: snap([googtag('G-1'), googtag('AW-1'), conv], AFTER), topologyRows: [row(['G-1', 'AW-1'], AFTER)] });
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('COMBINED');
  });

  it('a split topology but the Ads Google tag still missing from the synced container fails', () => {
    const r = evaluateSplitVerification({ ...base, snapshot: snap([googtag('G-1'), conv], AFTER), topologyRows: [row(['G-1'], AFTER), row(['AW-1'], AFTER)] });
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('no sitewide Google tag for the Google Ads');
  });

  it('no snapshot at all cannot verify', () => {
    expect(evaluateSplitVerification({ ...base, snapshot: null, topologyRows: [row(['G-1'], AFTER)] }).verified).toBe(false);
  });
});

describe('buildSplitGuidance (AC 17)', () => {
  const steps = buildSplitGuidance({ combinedTagIds: ['G-1'], ga4Id: 'G-1', adsId: 'AW-9', secondaryDomains: ['x.com'] });

  it('parameterises with the client IDs and covers the five PRD steps', () => {
    expect(steps).toHaveLength(5);
    expect(steps[0].body).toContain('AW-9');
    expect(steps[0].body).toContain('G-1');
    expect(steps[3].body).toContain('x.com');
  });

  it('the unverified admin-access claim is flagged unverified and worded as "may", never as fact', () => {
    expect(steps[0].evidence).toBe('unverified');
    expect(steps[0].body).toContain('You may need admin access');
  });

  it('the split location rests on Google docs (verified) and the unmeasured ordering is stated as unmeasured', () => {
    expect(steps[2].evidence).toBe('verified');
    expect(steps[2].body).toContain('split icon next to the destination ID');
    expect(steps[2].body).toContain('has not been measured');
  });

  it('never states the unverified "first config wins" or GA4-lock claims', () => {
    const text = steps.map((s) => s.body).join(' ').toLowerCase();
    expect(text).not.toContain('first config');
    expect(text).not.toContain('non-editable');
  });
});
