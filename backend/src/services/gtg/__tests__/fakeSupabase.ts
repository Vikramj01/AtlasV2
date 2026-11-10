/**
 * A tiny in-memory stand-in for the slice of supabase-js the GTG code uses, so
 * tests can exercise real read-modify-write behaviour (evidence arriving in
 * different orders) instead of canned chain mocks. Supports select / eq / neq /
 * in / not-is-null / order / limit / single / maybeSingle / insert / upsert /
 * update / delete on plain row arrays.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Table names for which any call returns an error (simulates a missing column / table). */
  failing: Set<string>;
  from(table: string): unknown;
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const failing = new Set<string>();
  let idSeq = 0;

  function builder(table: string) {
    const rows = (tables[table] ??= []);
    const filters: Filter[] = [];
    let mode: 'select' | 'update' | 'delete' | 'upsert' | 'insert' = 'select';
    let patch: Row | Row[] = {};
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    let wantSingle: 'single' | 'maybe' | null = null;
    let returning = false;

    const matches = (r: Row) => filters.every((f) => f(r));

    function run(): { data: unknown; error: { message: string } | null } {
      if (failing.has(table)) return { data: null, error: { message: `relation or column error on ${table}` } };

      let out: Row[] = [];
      if (mode === 'select') {
        out = rows.filter(matches);
      } else if (mode === 'update') {
        out = rows.filter(matches);
        for (const r of out) Object.assign(r, patch as Row);
      } else if (mode === 'delete') {
        out = rows.filter(matches);
        for (const r of out) rows.splice(rows.indexOf(r), 1);
      } else {
        const incoming = Array.isArray(patch) ? patch : [patch];
        const keys = (upsertOpts.onConflict ?? '').split(',').filter(Boolean);
        for (const item of incoming) {
          const existing = mode === 'upsert' && keys.length > 0 ? rows.find((r) => keys.every((k) => r[k] === item[k])) : undefined;
          if (existing) {
            if (!upsertOpts.ignoreDuplicates) { Object.assign(existing, item); out.push(existing); }
          } else {
            const created = { id: `id-${++idSeq}`, created_at: new Date().toISOString(), ...item };
            rows.push(created);
            out.push(created);
          }
        }
      }

      if (orderBy) {
        const { col, asc } = orderBy;
        out = [...out].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (asc ? 1 : -1));
      }
      if (limitN !== null) out = out.slice(0, limitN);

      if (wantSingle) {
        if (out.length === 0) return wantSingle === 'single' ? { data: null, error: { message: 'no rows' } } : { data: null, error: null };
        return { data: out[0], error: null };
      }
      // writes only return rows when .select() was chained
      return { data: mode === 'select' || returning ? out : null, error: null };
    }

    const b: Record<string, unknown> = {
      select() { if (mode !== 'select') returning = true; return b; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return b; },
      neq(col: string, v: unknown) { filters.push((r) => r[col] !== v); return b; },
      in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return b; },
      not(col: string, op: string, v: unknown) { if (op === 'is' && v === null) filters.push((r) => r[col] !== null && r[col] !== undefined); return b; },
      order(col: string, o?: { ascending?: boolean }) { orderBy = { col, asc: o?.ascending !== false }; return b; },
      limit(n: number) { limitN = n; return b; },
      single() { wantSingle = 'single'; return b; },
      maybeSingle() { wantSingle = 'maybe'; return b; },
      insert(p: Row | Row[]) { mode = 'insert'; patch = p; return b; },
      upsert(p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) { mode = 'upsert'; patch = p; upsertOpts = o ?? {}; return b; },
      update(p: Row) { mode = 'update'; patch = p; return b; },
      delete() { mode = 'delete'; return b; },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try { return Promise.resolve(run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return b;
  }

  return { tables, failing, from: (t: string) => builder(t) };
}
