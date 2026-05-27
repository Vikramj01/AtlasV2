/**
 * Onboarding routes — /api/onboarding
 *
 * GET  /status          — Full checklist state for the current org (admin only)
 * POST /skip            — Mark an optional step as skipped
 * POST /dismiss         — Hide checklist from Dashboard
 * POST /reset           — Clear all skip/dismiss/complete state
 * POST /accept-taxonomy — Write taxonomy_accepted_at to organisations
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { supabaseAdmin } from '@/services/database/supabase';
import { getOnboardingStatus } from '@/services/onboarding/onboardingStatusService';
import logger from '@/utils/logger';

const router = Router();
router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveOrgId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  return (data as { organization_id: string } | null)?.organization_id ?? null;
}

async function isAdmin(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('organisation_members')
    .select('role')
    .eq('organisation_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { role: string } | null)?.role === 'admin';
}

// ── GET /api/onboarding/status ────────────────────────────────────────────────

router.get('/status', async (req: Request, res: Response) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    if (!(await isAdmin(orgId, req.user!.id))) {
      return res.status(403).json({ data: null, error: 'Admin access required', message: null });
    }

    const status = await getOnboardingStatus(orgId);
    res.json({ data: status, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch onboarding status');
    sendInternalError(res, err);
  }
});

// ── POST /api/onboarding/skip ─────────────────────────────────────────────────

const SkipSchema = z.object({
  step_id: z.enum(['1.2', '1.3', '1.4']),
});

router.post('/skip', async (req: Request, res: Response) => {
  const parsed = SkipSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ data: null, error: parsed.error.errors[0]?.message ?? 'Invalid request', message: null });
  }

  try {
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    if (!(await isAdmin(orgId, req.user!.id))) {
      return res.status(403).json({ data: null, error: 'Admin access required', message: null });
    }

    const { step_id } = parsed.data;
    const now = new Date().toISOString();

    // Read existing steps_state, merge the skipped entry
    const { data: existing } = await supabaseAdmin
      .from('organisation_onboarding_state')
      .select('steps_state')
      .eq('organization_id', orgId)
      .maybeSingle();

    const currentState = (existing as { steps_state: Record<string, unknown> } | null)?.steps_state ?? {};
    const updatedState = { ...currentState, [step_id]: { status: 'skipped', at: now } };

    await supabaseAdmin
      .from('organisation_onboarding_state')
      .upsert(
        { organization_id: orgId, steps_state: updatedState, updated_at: now },
        { onConflict: 'organization_id' },
      );

    res.json({ data: { step_id, status: 'skipped' }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Failed to skip onboarding step');
    sendInternalError(res, err);
  }
});

// ── POST /api/onboarding/dismiss ──────────────────────────────────────────────

router.post('/dismiss', async (req: Request, res: Response) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    if (!(await isAdmin(orgId, req.user!.id))) {
      return res.status(403).json({ data: null, error: 'Admin access required', message: null });
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from('organisation_onboarding_state')
      .upsert(
        { organization_id: orgId, dismissed_at: now, updated_at: now },
        { onConflict: 'organization_id' },
      );

    res.json({ data: { dismissed_at: now }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Failed to dismiss onboarding');
    sendInternalError(res, err);
  }
});

// ── POST /api/onboarding/reset ────────────────────────────────────────────────

router.post('/reset', async (req: Request, res: Response) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    if (!(await isAdmin(orgId, req.user!.id))) {
      return res.status(403).json({ data: null, error: 'Admin access required', message: null });
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from('organisation_onboarding_state')
      .upsert(
        {
          organization_id: orgId,
          steps_state: {},
          dismissed_at: null,
          completed_at: null,
          updated_at: now,
        },
        { onConflict: 'organization_id' },
      );

    res.json({ data: { reset: true }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Failed to reset onboarding');
    sendInternalError(res, err);
  }
});

// ── POST /api/onboarding/accept-taxonomy ──────────────────────────────────────

router.post('/accept-taxonomy', async (req: Request, res: Response) => {
  try {
    const orgId = await resolveOrgId(req.user!.id);
    if (!orgId) return res.status(403).json({ data: null, error: 'No organisation found', message: null });

    if (!(await isAdmin(orgId, req.user!.id))) {
      return res.status(403).json({ data: null, error: 'Admin access required', message: null });
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('organisations')
      .update({ taxonomy_accepted_at: now })
      .eq('id', orgId);

    if (error) throw new Error(error.message);

    res.json({ data: { accepted_at: now }, error: null, message: null });
  } catch (err) {
    logger.error({ err }, 'Failed to accept taxonomy defaults');
    sendInternalError(res, err);
  }
});

export { router as onboardingRouter };
