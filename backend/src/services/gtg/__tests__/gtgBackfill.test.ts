import { describe, it, expect } from 'vitest';
import { buildBackfillReport } from '../gtgBackfill';

const row = (id: string, org: string, status: unknown, conn: boolean) => ({
  client_id: id, organisation_id: org, gtg_status: status, org_has_gtm_connection: conn,
});

describe('buildBackfillReport', () => {
  it('counts old-flag false positives: GTM connected, nothing verified', () => {
    const r = buildBackfillReport([row('c1', 'o1', 'unknown', true), row('c2', 'o1', 'verified', true)]);
    expect(r.old_flag).toEqual({ active: 2, inactive: 0 });
    expect(r.false_positives).toEqual(['c1']);
  });

  it('reports orgs whose cap lifts (old flag false, new status unknown)', () => {
    const r = buildBackfillReport([row('c1', 'o1', null, false), row('c2', 'o2', 'not_detected', false)]);
    expect(r.cap_lifted_orgs).toEqual(['o1']);
  });

  it('does not report a cap as lifted if any client in the org is still capped', () => {
    const r = buildBackfillReport([row('c1', 'o1', 'unknown', false), row('c2', 'o1', 'broken', false)]);
    expect(r.cap_lifted_orgs).toEqual([]);
  });

  it('distributes statuses and treats junk values as unknown', () => {
    const r = buildBackfillReport([row('c1', 'o1', 'verified', false), row('c2', 'o1', 'garbage', false)]);
    expect(r.new_status.verified).toBe(1);
    expect(r.new_status.unknown).toBe(1);
    expect(r.clients).toBe(2);
  });
});
