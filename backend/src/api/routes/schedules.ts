/**
 * Scheduled Audits API — /api/schedules
 *
 * POST   /api/schedules          — create a new scheduled audit
 * GET    /api/schedules          — list the user's schedules
 * GET    /api/schedules/:id      — get a single schedule
 * PATCH  /api/schedules/:id      — update (toggle active, change frequency/timing)
 * DELETE /api/schedules/:id      — delete
 * POST   /api/schedules/:id/run  — trigger an immediate one-off run (bypasses next_run_at)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { validateUrl, validateUrls } from '@/utils/urlValidator';
import { createAudit } from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import {
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  markScheduleRan,
} from '@/services/database/scheduleQueries';
import type { CreateScheduleInput, UpdateScheduleInput } from '@/types/schedule';
import type { FunnelType, Region } from '@/types/audit';
import logger from '@/utils/logger';

export const schedulesRouter = Router();
schedulesRouter.use(authMiddleware);

const VALID_FUNNEL_TYPES: FunnelType[] = ['ecommerce', 'saas', 'lead_gen'];
const VALID_FREQUENCIES = ['daily', 'weekly'] as const;

// ── POST /api/schedules ───────────────────────────────────────────────────────

schedulesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const body = req.body as Partial<CreateScheduleInput>;

  if (!body.name || !body.website_url || !body.funnel_type || !body.url_map || !body.frequency) {
    res.status(400).json({ error: 'name, website_url, funnel_type, url_map, and frequency are required' });
    return;
  }
  if (!VALID_FUNNEL_TYPES.includes(body.funnel_type as FunnelType)) {
    res.status(400).json({ error: `funnel_type must be one of: ${VALID_FUNNEL_TYPES.join(', ')}` });
    return;
  }
  if (!VALID_FREQUENCIES.includes(body.frequency as 'daily' | 'weekly')) {
    res.status(400).json({ error: 'frequency must be daily or weekly' });
    return;
  }
  if (body.frequency === 'weekly' && (body.day_of_week == null || body.day_of_week < 0 || body.day_of_week > 6)) {
    res.status(400).json({ error: 'day_of_week (0–6) is required for weekly schedules' });
    return;
  }
  if (body.hour_utc !== undefined && (body.hour_utc < 0 || body.hour_utc > 23)) {
    res.status(400).json({ error: 'hour_utc must be 0–23' });
    return;
  }

  const urlCheck = validateUrl(body.website_url);
  if (!urlCheck.valid) {
    res.status(400).json({ error: `Invalid website_url: ${urlCheck.error}` });
    return;
  }

  const mapUrls = Object.values(body.url_map as Record<string, unknown>).filter((v) => typeof v === 'string') as string[];
  const mapUrlError = validateUrls(mapUrls);
  if (mapUrlError) {
    res.status(400).json({ error: `Invalid URL in url_map: ${mapUrlError}` });
    return;
  }

  try {
    const schedule = await createSchedule(userId, body as CreateScheduleInput);
    logger.info({ scheduleId: schedule.id, userId }, 'Scheduled audit created');
    res.status(201).json(schedule);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/schedules ────────────────────────────────────────────────────────

schedulesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const schedules = await listSchedules(req.user.id);
    res.json(schedules);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/schedules/:id ────────────────────────────────────────────────────

schedulesRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const schedule = await getSchedule(req.params.id, req.user.id);
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }
    res.json(schedule);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── PATCH /api/schedules/:id ──────────────────────────────────────────────────

schedulesRouter.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Partial<UpdateScheduleInput>;

  if (body.frequency && !VALID_FREQUENCIES.includes(body.frequency as 'daily' | 'weekly')) {
    res.status(400).json({ error: 'frequency must be daily or weekly' });
    return;
  }
  if (body.hour_utc !== undefined && (body.hour_utc < 0 || body.hour_utc > 23)) {
    res.status(400).json({ error: 'hour_utc must be 0–23' });
    return;
  }

  try {
    const existing = await getSchedule(req.params.id, req.user.id);
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const updated = await updateSchedule(req.params.id, req.user.id, body);
    res.json(updated);
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── DELETE /api/schedules/:id ─────────────────────────────────────────────────

schedulesRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await getSchedule(req.params.id, req.user.id);
    if (!existing) { res.status(404).json({ error: 'Schedule not found' }); return; }

    await deleteSchedule(req.params.id, req.user.id);
    res.json({ deleted: true });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/schedules/:id/run ───────────────────────────────────────────────
// Immediately trigger a one-off run of a schedule (ignores next_run_at).

schedulesRouter.post('/:id/run', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;

  try {
    const schedule = await getSchedule(req.params.id, userId);
    if (!schedule) { res.status(404).json({ error: 'Schedule not found' }); return; }

    const audit = await createAudit({
      user_id: userId,
      website_url: schedule.website_url,
      funnel_type: schedule.funnel_type as FunnelType,
      region: schedule.region as Region,
    });

    await auditQueue.add({
      audit_id: audit.id,
      website_url: schedule.website_url,
      funnel_type: schedule.funnel_type,
      region: schedule.region,
      url_map: schedule.url_map,
      scheduled_audit_id: schedule.id,
    });

    await markScheduleRan(
      schedule.id,
      audit.id,
      schedule.frequency,
      schedule.hour_utc,
      schedule.day_of_week,
    );

    logger.info({ scheduleId: schedule.id, auditId: audit.id, userId }, 'Manual schedule run triggered');

    res.status(202).json({ audit_id: audit.id, status: 'queued' });
  } catch (err) {
    sendInternalError(res, err);
  }
});
