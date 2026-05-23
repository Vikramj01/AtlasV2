/**
 * Signal Tracking Dashboard API — /api/signal-events
 *
 * GET  /api/signal-events                    Paginated signal list with filters
 * GET  /api/signal-events/aggregates         Aggregate card metrics
 * GET  /api/signal-events/:event_id          Single signal detail (404 on cross-org)
 * POST /api/signal-events/export             Kick off async CSV export job
 * GET  /api/signal-events/export/:job_id     Poll export job status
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import logger from '@/utils/logger';
import {
  listSignalEvents,
  getSignalEventDetail,
  getSignalAggregates,
  createExportJob,
  getExportJob,
  countSignalEvents,
} from '@/services/database/signalEventQueries';

export const signalEventsRouter = Router();
signalEventsRouter.use(authMiddleware);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const listSchema = z.object({
  from:           z.string().regex(ISO_REGEX, 'from must be an ISO timestamp').default(() => {
    const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString();
  }),
  to:             z.string().regex(ISO_REGEX, 'to must be an ISO timestamp').default(() => new Date().toISOString()),
  destinations:   z.string().optional().transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
  event_names:    z.string().optional().transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
  statuses:       z.string().optional().transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
  dedup_statuses: z.string().optional().transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
  cursor:         z.string().optional(),
  limit:          z.coerce.number().int().min(1).max(200).default(50),
});

const aggregatesSchema = z.object({
  from:         z.string().regex(ISO_REGEX).default(() => {
    const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString();
  }),
  to:           z.string().regex(ISO_REGEX).default(() => new Date().toISOString()),
  destinations: z.string().optional().transform((v) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined),
});

const exportSchema = z.object({
  from:         z.string().regex(ISO_REGEX, 'from must be an ISO timestamp'),
  to:           z.string().regex(ISO_REGEX, 'to must be an ISO timestamp'),
  destinations: z.array(z.string()).optional(),
  event_names:  z.array(z.string()).optional(),
  statuses:     z.array(z.string()).optional(),
});

// ── GET /api/signal-events ────────────────────────────────────────────────────

signalEventsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const parse = listSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parse.error.flatten() });
    return;
  }

  const organization_id = req.user.id;
  const { from, to, destinations, event_names, statuses, dedup_statuses, cursor, limit } = parse.data;

  try {
    logger.info({ organization_id, from, to, limit }, 'Listing signal events');

    const { rows, next_cursor } = await listSignalEvents({
      organization_id,
      from,
      to,
      destinations,
      event_names,
      statuses,
      dedup_statuses,
      cursor,
      limit,
    });

    res.json({ data: rows, next_cursor, count: rows.length });
  } catch (err) {
    sendInternalError(res, err, 'signal-events-list');
  }
});

// ── GET /api/signal-events/aggregates ─────────────────────────────────────────
// Must be registered before /:event_id to avoid Express matching "aggregates"
// as an event_id parameter.

signalEventsRouter.get('/aggregates', async (req: Request, res: Response): Promise<void> => {
  const parse = aggregatesSchema.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parse.error.flatten() });
    return;
  }

  const organization_id = req.user.id;
  const { from, to, destinations } = parse.data;

  try {
    logger.info({ organization_id, from, to }, 'Fetching signal aggregates');
    const result = await getSignalAggregates(organization_id, from, to, destinations);
    res.json({ data: result });
  } catch (err) {
    sendInternalError(res, err, 'signal-events-aggregates');
  }
});

// ── POST /api/signal-events/export ────────────────────────────────────────────

signalEventsRouter.post('/export', async (req: Request, res: Response): Promise<void> => {
  const parse = exportSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.flatten() });
    return;
  }

  const organization_id = req.user.id;
  const filters = parse.data;

  try {
    const rowCount = await countSignalEvents(organization_id, {
      from:         filters.from,
      to:           filters.to,
      destinations: filters.destinations,
      event_names:  filters.event_names,
      statuses:     filters.statuses,
    });

    if (rowCount > 100_000) {
      res.status(422).json({
        error: 'Export exceeds 100,000 row limit. Narrow your time range or filters.',
        row_estimate: rowCount,
      });
      return;
    }

    const job = await createExportJob(organization_id, filters, rowCount);

    // Sprint 5 will enqueue the Bull job here. For now the record is created
    // in 'pending' state and the worker will be wired up in that sprint.
    logger.info({ organization_id, job_id: job.id, row_estimate: rowCount }, 'Signal export job created');

    res.status(202).json({ data: { job_id: job.id, row_estimate: rowCount } });
  } catch (err) {
    sendInternalError(res, err, 'signal-events-export-create');
  }
});

// ── GET /api/signal-events/export/:job_id ─────────────────────────────────────

signalEventsRouter.get('/export/:job_id', async (req: Request, res: Response): Promise<void> => {
  const organization_id = req.user.id;
  const { job_id } = req.params;

  try {
    const job = await getExportJob(organization_id, job_id);

    if (!job) {
      res.status(404).json({ error: 'Export job not found' });
      return;
    }

    res.json({ data: job });
  } catch (err) {
    sendInternalError(res, err, 'signal-events-export-poll');
  }
});

// ── GET /api/signal-events/:event_id ─────────────────────────────────────────
// Registered last — matches any string not caught by /aggregates or /export/*.
// Returns 404 (not 403) for cross-org events to prevent existence leaking.

signalEventsRouter.get('/:event_id', async (req: Request, res: Response): Promise<void> => {
  const organization_id = req.user.id;
  const { event_id } = req.params;

  try {
    logger.info({ organization_id, event_id }, 'Fetching signal event detail');
    const detail = await getSignalEventDetail(organization_id, event_id);

    if (!detail) {
      res.status(404).json({ error: 'Signal event not found' });
      return;
    }

    res.json({ data: detail });
  } catch (err) {
    sendInternalError(res, err, 'signal-events-detail');
  }
});
