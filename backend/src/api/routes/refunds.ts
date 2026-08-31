/**
 * Refund/return feedback API routes — all endpoints under /api/refunds
 *
 * POST /api/refunds              — record a refund; fires Google audience
 *                                   removal (fire-and-forget)
 * GET  /api/refunds              — list refunds for the authenticated org
 * GET  /api/refunds/:id/adjustment.csv — generate + download the best-effort
 *                                   adjustment CSV for one refund
 *
 * All routes require authMiddleware. See refundDelivery.ts for why this
 * feature has no single "send the refund" call — DMA has no adjustment
 * capability, so Google Ads gets two independent, best-effort legs instead.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import {
  recordRefund,
  listRefunds,
  removeFromGoogleAudience,
  generateAdjustmentCsv,
  markAdjustmentCsvGenerated,
} from '@/services/capi/refundDelivery';
import { supabaseAdmin } from '@/services/database/supabase';
import type { RefundEvent } from '@/types/refunds';
import logger from '@/utils/logger';

export const refundsRouter = Router();

refundsRouter.use(authMiddleware);

// ── POST /api/refunds ──────────────────────────────────────────────────────────

const RecordRefundSchema = z.object({
  original_transaction_id: z.string().min(1),
  refund_amount: z.number().positive(),
  currency: z.string().length(3),
  is_partial: z.boolean().default(false),
  // Required for partial refunds — Google's RESTATEMENT adjustment needs the
  // corrected order total (absolute value), which Atlas has no way to derive
  // on its own. See refundDelivery.ts's generateAdjustmentCsv().
  new_conversion_value: z.number().nonnegative().optional(),
  reason: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  client_id: z.string().uuid().optional(),
}).refine(
  (v) => !v.is_partial || v.new_conversion_value !== undefined,
  { message: 'new_conversion_value is required for a partial refund', path: ['new_conversion_value'] },
);

refundsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = RecordRefundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: 'VALIDATION_FAILED',
      message: parsed.error.issues[0]?.message ?? 'Invalid request body',
    });
    return;
  }

  const { email, phone, ...input } = parsed.data;
  const orgId = req.user!.id;

  try {
    const refund = await recordRefund(orgId, orgId, { ...input, email, phone });

    // Fire-and-forget: never blocks the response — the refund is already
    // durably recorded above regardless of the Google delivery outcome.
    // Uses the RAW email/phone from the request (never persisted) so
    // ingestCustomerMatchBatch's own internal hashing isn't double-applied
    // against an already-hashed value.
    void removeFromGoogleAudience(orgId, refund.id, email, phone);

    res.status(201).json({ data: refund, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to record refund');
  }
});

// ── GET /api/refunds ────────────────────────────────────────────────────────────

refundsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const refunds = await listRefunds(req.user!.id);
    res.json({ data: refunds, error: null, message: null });
  } catch (err) {
    sendInternalError(res, err, 'Failed to list refunds');
  }
});

// ── GET /api/refunds/:id/adjustment.csv ────────────────────────────────────────

refundsRouter.get('/:id/adjustment.csv', async (req: Request, res: Response): Promise<void> => {
  const orgId = req.user!.id;

  try {
    const { data, error } = await supabaseAdmin
      .from('refund_events')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      res.status(404).json({ data: null, error: 'NOT_FOUND', message: 'Refund not found' });
      return;
    }

    const refund = data as RefundEvent;
    const csv = generateAdjustmentCsv(refund);
    void markAdjustmentCsvGenerated(refund.id);

    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="refund-adjustment-${refund.original_transaction_id}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[refunds] Failed to generate adjustment CSV');
    sendInternalError(res, err, 'Failed to generate adjustment CSV');
  }
});
