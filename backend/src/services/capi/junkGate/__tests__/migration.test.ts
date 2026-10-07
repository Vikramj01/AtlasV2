/**
 * Static guard against the dqm_sgtm failure mode (a status the code writes that the shared CHECK
 * never allowed, silently throwing on insert): migration 20260922004's capi_events status list
 * must contain every CAPIEventStatus the code can write, in BOTH the backend and frontend types,
 * and keep every live value read from the project before the migration was written.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../../../..');
const sql = readFileSync(join(root, 'supabase/migrations/20260922004_junk_gate.sql'), 'utf8');

const list = (re: RegExp, text: string): string[] => {
  const m = re.exec(text);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

describe('migration 20260922004', () => {
  const allowed = list(/ADD CONSTRAINT capi_events_status_check CHECK \(status IN \(([\s\S]*?)\)\);/, sql);

  it('keeps every capi_events status that was live when it was written', () => {
    for (const s of ['received', 'consent_valid', 'consent_blocked', 'validated', 'prepared', 'delivered', 'delivery_failed', 'dead_letter']) {
      expect(allowed).toContain(s);
    }
  });

  it.each(['backend/src/types/capi.ts', 'frontend/src/types/capi.ts'])('allows every CAPIEventStatus in %s', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    const union = /export type CAPIEventStatus =([\s\S]*?);/.exec(src)![1];
    const codeStatuses = [...union.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(codeStatuses).toContain('junk_held');
    expect(codeStatuses).toContain('junk_rejected');
    for (const s of codeStatuses) expect(allowed, s).toContain(s);
  });

  it('conversion_holds statuses and verdicts match what the gate writes', () => {
    expect(list(/status\s+text\s+NOT NULL CHECK \(status IN \(([\s\S]*?)\)\)/, sql)).toEqual(['observed', 'held', 'released', 'rejected', 'auto_released', 'auto_dropped']);
    expect(list(/verdict\s+text\s+NOT NULL CHECK \(verdict IN \(([\s\S]*?)\)\)/, sql)).toEqual(['junk', 'suspect', 'clean']);
  });

  it('enforces one record per Atlas event and defaults to observe', () => {
    expect(sql).toMatch(/UNIQUE \(organization_id, atlas_event_id\)/);
    expect(sql).toMatch(/mode\s+text\s+NOT NULL DEFAULT 'observe'/);
    expect(sql).toMatch(/timeout_action\s+text\s+NOT NULL DEFAULT 'release'/);
  });

  it('enables RLS on both new tables', () => {
    expect(sql).toMatch(/ALTER TABLE junk_gate_configs ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE conversion_holds ENABLE ROW LEVEL SECURITY/);
  });

  it('the migration filename follows the repo\'s YYYYMMDDNNN_name.sql form (Key Technical Decision §21)', () => {
    expect('20260922004_junk_gate.sql').toMatch(/^\d{11}_[a-z_]+\.sql$/);
  });
});
