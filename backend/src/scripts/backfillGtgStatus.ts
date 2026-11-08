/**
 * GTG status back-fill (docs/prd/google-tag-gateway.md §5.4, Sprint 1).
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillGtgStatus.ts           # report only
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfillGtgStatus.ts --apply   # also stamp gtg_status_updated_at
 *
 * Requires migration 20260925001 to be applied. Prints the old-flag versus
 * new-status distribution as JSON. Statuses are NOT derived here: that needs
 * Sprint 2's matcher. --apply only stamps `gtg_status_updated_at` on clients
 * that have never had a status, so the UI can show a one-cycle "status
 * recomputed" note; it never changes a stored status.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { buildBackfillReport, type BackfillClientInput } from '@/services/gtg/gtgBackfill';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, organisation_id, gtg_status, gtg_status_updated_at')
    .neq('status', 'archived');
  if (error) throw new Error(error.message);

  const { data: conns, error: connErr } = await supabaseAdmin
    .from('gtm_container_connections')
    .select('organization_id');
  if (connErr) throw new Error(connErr.message);
  const orgsWithConn = new Set((conns ?? []).map((c) => (c as { organization_id: string }).organization_id));

  const rows: BackfillClientInput[] = (clients ?? []).map((c) => {
    const row = c as { id: string; organisation_id: string; gtg_status: unknown };
    return {
      client_id: row.id,
      organisation_id: row.organisation_id,
      gtg_status: row.gtg_status,
      org_has_gtm_connection: orgsWithConn.has(row.organisation_id),
    };
  });

  let stamped = 0;
  if (apply) {
    const toStamp = (clients ?? [])
      .filter((c) => (c as { gtg_status_updated_at: string | null }).gtg_status_updated_at === null)
      .map((c) => (c as { id: string }).id);
    if (toStamp.length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from('clients')
        .update({ gtg_status_updated_at: new Date().toISOString() })
        .in('id', toStamp);
      if (updErr) throw new Error(updErr.message);
      stamped = toStamp.length;
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ applied: apply, stamped, ...buildBackfillReport(rows) }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
