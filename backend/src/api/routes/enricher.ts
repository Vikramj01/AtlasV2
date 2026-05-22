/**
 * Bid Signal Enricher API — /api/enricher
 *
 * POST /api/enricher/runs   — trigger a multi-destination audience push
 * GET  /api/enricher/runs   — list run history with match-rate telemetry
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { planGuard } from '@/api/middleware/planGuard';
import { supabaseAdmin } from '@/services/database/supabase';
import { runAudienceEnricher } from '@/services/enricher/enricherService';
import { DMAClientError } from '@/integrations/google/dmaClient';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';

export const enricherRouter = Router();
enricherRouter.use(authMiddleware);

// ── Zod schema ────────────────────────────────────────────────────────────────

const RunSchema = z.object({
  destinations: z
    .array(
      z.object({
        type: z.enum(['GOOGLE_ADS', 'GA4', 'DV360', 'CM360']),
        customerId: z.string().optional(),
        propertyId: z.string().optional(),
        advertiserId: z.string().optional(),
      }),
    )
    .min(1),
  contacts: z
    .array(
      z.object({
        email: z.string().optional(),
        phone: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .min(1)
    .max(500_000),
  operation_type: z.enum(['CREATE', 'REMOVE']).default('CREATE'),
});

// ── POST /api/enricher/runs ───────────────────────────────────────────────────

enricherRouter.post('/runs', planGuard('pro'), async (req: Request, res: Response) => {
  const parsed = RunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { destinations, contacts, operation_type } = parsed.data;
  const orgId = req.user!.id;

  try {
    const result = await runAudienceEnricher(orgId, destinations, contacts, operation_type);
    res.status(201).json({ data: result });
  } catch (err) {
    if (err instanceof DMAClientError && err.status === 401) {
      res.status(400).json({
        error: 'DMA_NOT_CONNECTED',
        message: 'Connect Google Ads via Platform Connections first.',
      });
      return;
    }
    logger.error({ err: err instanceof Error ? err.message : String(err), orgId }, 'enricher/runs POST: error');
    sendInternalError(res, err instanceof Error ? err : new Error(String(err)));
  }
});

// ── GET /api/enricher/runs ────────────────────────────────────────────────────

enricherRouter.get('/runs', planGuard('pro'), async (req: Request, res: Response) => {
  const orgId = req.user!.id;

  const { data: runs, error } = await supabaseAdmin
    .from('enricher_runs')
    .select(
      'id, ingest_type, destinations, operation_type, status, record_count, matched_count, failed_count, match_rate, error_message, triggered_by, created_at',
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error.message, orgId }, 'enricher/runs GET: DB error');
    res.status(500).json({ error: 'Failed to fetch enricher runs' });
    return;
  }

  res.json({ data: runs ?? [] });
});
