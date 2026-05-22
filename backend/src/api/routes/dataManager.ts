import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { planGuard } from '@/api/middleware/planGuard';
import { supabaseAdmin } from '@/services/database/supabase';

export const dataManagerRouter = Router();
dataManagerRouter.use(authMiddleware, planGuard('agency'));

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientRow = { id: string; name: string; website_url: string };

type DMAStateRow = {
  upload_success_rate: number | null;
  avg_match_rate: number | null;
  total_members_30d: number;
  destination_count: number;
  last_successful_at: string | null;
};

type TrendRow = { matched_count: number | null; record_count: number; created_at: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeNeedsAction(gtgActive: boolean, dma: DMAStateRow | null): string[] {
  const flags: string[] = [];
  if (!gtgActive) flags.push('gtg_not_deployed');
  if (!dma?.last_successful_at) flags.push('dma_not_connected');
  if (dma?.avg_match_rate !== null && dma?.avg_match_rate !== undefined && dma.avg_match_rate < 20)
    flags.push('low_match_rate');
  return flags;
}

async function buildClientSummary(client: ClientRow) {
  const [dmaState, gtgConn, enricherTrend] = await Promise.all([
    supabaseAdmin
      .from('dqm_dma_poll_state')
      .select('upload_success_rate, avg_match_rate, total_members_30d, destination_count, last_successful_at')
      .eq('org_id', client.id)
      .maybeSingle(),
    supabaseAdmin
      .from('gtm_container_connections')
      .select('id')
      .eq('organization_id', client.id)
      .limit(1),
    supabaseAdmin
      .from('enricher_runs')
      .select('matched_count, record_count, created_at')
      .eq('org_id', client.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const dma = dmaState.data as DMAStateRow | null;
  const gtgActive = (gtgConn.data?.length ?? 0) > 0;
  const trend = (enricherTrend.data ?? []) as TrendRow[];

  const trendPoints = trend.map((r) => ({
    date: r.created_at.slice(0, 10),
    matchRate:
      r.record_count > 0
        ? Math.round(((r.matched_count ?? 0) / r.record_count) * 100)
        : null,
  }));

  return {
    client_id: client.id,
    client_name: client.name,
    website_url: client.website_url,
    gtg_active: gtgActive,
    avg_match_rate: dma?.avg_match_rate ?? null,
    upload_success_rate: dma?.upload_success_rate ?? null,
    total_members_30d: dma?.total_members_30d ?? 0,
    destination_count: dma?.destination_count ?? 0,
    last_dma_activity: dma?.last_successful_at ?? null,
    trend_points: trendPoints,
    needs_action: computeNeedsAction(gtgActive, dma),
  };
}

async function buildClientCsvRow(client: ClientRow): Promise<string> {
  const [dmaState, gtgConn] = await Promise.all([
    supabaseAdmin
      .from('dqm_dma_poll_state')
      .select('upload_success_rate, avg_match_rate, total_members_30d, destination_count, last_successful_at')
      .eq('org_id', client.id)
      .maybeSingle(),
    supabaseAdmin
      .from('gtm_container_connections')
      .select('id')
      .eq('organization_id', client.id)
      .limit(1),
  ]);

  const dma = dmaState.data as DMAStateRow | null;
  const gtgActive = (gtgConn.data?.length ?? 0) > 0;
  const needsAction = computeNeedsAction(gtgActive, dma);

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    escape(client.name),
    escape(client.website_url),
    gtgActive ? 'yes' : 'no',
    dma?.avg_match_rate?.toFixed(1) ?? '',
    dma?.upload_success_rate?.toFixed(1) ?? '',
    String(dma?.total_members_30d ?? 0),
    String(dma?.destination_count ?? 0),
    dma?.last_successful_at?.slice(0, 10) ?? '',
    escape(needsAction.join('; ')),
  ].join(',');
}

// ── GET /api/data-manager/:orgId/clients ─────────────────────────────────────

dataManagerRouter.get('/:orgId/clients', async (req: Request, res: Response) => {
  const { orgId } = req.params;

  const { data: clients, error: clientsError } = await supabaseAdmin
    .from('clients')
    .select('id, name, website_url')
    .eq('organization_id', orgId);

  if (clientsError) {
    res.status(500).json({ error: 'Failed to fetch clients' });
    return;
  }

  if (!clients || clients.length === 0) {
    res.json({ clients: [] });
    return;
  }

  const clientRows = await Promise.all((clients as ClientRow[]).map(buildClientSummary));
  res.json({ clients: clientRows });
});

// ── GET /api/data-manager/:orgId/export/csv ───────────────────────────────────

dataManagerRouter.get('/:orgId/export/csv', async (req: Request, res: Response) => {
  const { orgId } = req.params;

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, website_url')
    .eq('organization_id', orgId);

  const header =
    'client_name,website_url,gtg_active,avg_match_rate,upload_success_rate,total_members_30d,destination_count,last_dma_activity,needs_action';

  if (!clients || clients.length === 0) {
    res.set('Content-Type', 'text/csv');
    res.send(header + '\n');
    return;
  }

  const rows = await Promise.all((clients as ClientRow[]).map(buildClientCsvRow));
  const csv = [header, ...rows].join('\n');

  res.set('Content-Type', 'text/csv');
  res.set(
    'Content-Disposition',
    `attachment; filename="dma-console-${orgId}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(csv);
});
