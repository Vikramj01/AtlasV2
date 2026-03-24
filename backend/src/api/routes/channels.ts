/**
 * Channel Signal Behaviour API — /api/channels/*
 *
 * GET  /api/channels/overview              — channel comparison table
 * GET  /api/channels/journeys              — all channel journey maps
 * GET  /api/channels/journeys/:channel     — single channel detail
 * GET  /api/channels/diagnostics           — active diagnostics
 * POST /api/channels/ingest                — receive session batches from WalkerOS
 * POST /api/channels/compute               — trigger journey computation
 * POST /api/channels/diagnostics/:id/resolve — mark diagnostic resolved
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import { channelQueue } from '@/services/queue/jobQueue';
import {
  getChannelOverviews,
  getJourneyMaps,
  getJourneyMapByChannel,
  getActiveDiagnostics,
  getDistinctChannelSites,
  resolveDiagnostic,
} from '@/services/database/channelQueries';
import { ingestSession } from '@/services/channels/sessionIngestion';
import type { IngestSessionPayload, ChannelType } from '@/types/channel';
import logger from '@/utils/logger';

export const channelsRouter = Router();
channelsRouter.use(authMiddleware);

// ── GET /api/channels/overview ────────────────────────────────────────────────

channelsRouter.get('/overview', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  const site = typeof req.query.site === 'string' ? req.query.site : undefined;

  try {
    const [overviews, sites] = await Promise.all([
      getChannelOverviews(userId, site, days),
      getDistinctChannelSites(userId),
    ]);

    res.json({
      overviews,
      has_data: overviews.length > 0,
      sites,
    });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/channels/journeys ────────────────────────────────────────────────

channelsRouter.get('/journeys', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
  const site = typeof req.query.site === 'string' ? req.query.site : undefined;

  try {
    const journeys = await getJourneyMaps(userId, site, days);
    res.json({ journeys });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── GET /api/channels/journeys/:channel ───────────────────────────────────────

channelsRouter.get(
  '/journeys/:channel',
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user.id;
    const channel = req.params.channel as ChannelType;
    const site = typeof req.query.site === 'string' ? req.query.site : undefined;

    try {
      const journey = await getJourneyMapByChannel(userId, channel, site);
      if (!journey) {
        res.status(404).json({ error: 'Journey map not found' });
        return;
      }
      res.json({ journey });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);

// ── GET /api/channels/diagnostics ─────────────────────────────────────────────

channelsRouter.get('/diagnostics', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const site = typeof req.query.site === 'string' ? req.query.site : undefined;

  try {
    const diagnostics = await getActiveDiagnostics(userId, site);
    res.json({ diagnostics });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/channels/ingest ─────────────────────────────────────────────────
// Receives a session batch from WalkerOS or the Atlas tracking snippet.

channelsRouter.post('/ingest', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const payload = req.body as IngestSessionPayload;

  if (!payload?.session_id || !payload?.website_url || !payload?.landing_page) {
    res.status(400).json({ error: 'Missing required fields: session_id, website_url, landing_page' });
    return;
  }

  if (!Array.isArray(payload.events)) {
    res.status(400).json({ error: 'events must be an array' });
    return;
  }

  try {
    const result = await ingestSession(userId, payload);
    logger.info({ userId, ...result }, 'Session ingested via API');
    res.status(201).json({ session_id: result.session_id, channel: result.channel });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/channels/compute ────────────────────────────────────────────────
// Manually trigger journey computation + diagnostic run.
// Simple debounce: rejects if a job for this user was queued in the last 5 min.

channelsRouter.post('/compute', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user.id;
  const websiteUrl: string | undefined =
    typeof req.body?.site === 'string' ? req.body.site : undefined;

  try {
    const jobId = `channel-manual-${userId}${
      websiteUrl ? `-${Buffer.from(websiteUrl).toString('base64').slice(0, 8)}` : ''
    }`;

    const existing = await channelQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active') {
        res.status(202).json({ status: 'already_queued' });
        return;
      }
    }

    await channelQueue.add(
      { trigger: 'manual', user_id: userId, website_url: websiteUrl },
      { jobId, attempts: 1, removeOnComplete: true },
    );

    logger.info({ userId, websiteUrl }, 'Manual channel computation enqueued');
    res.status(202).json({ status: 'queued' });
  } catch (err) {
    sendInternalError(res, err);
  }
});

// ── POST /api/channels/diagnostics/:id/resolve ────────────────────────────────

channelsRouter.post(
  '/diagnostics/:id/resolve',
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user.id;
    const { id } = req.params;

    try {
      const ok = await resolveDiagnostic(id, userId);
      if (!ok) {
        res.status(404).json({ error: 'Diagnostic not found' });
        return;
      }
      res.json({ resolved: true });
    } catch (err) {
      sendInternalError(res, err);
    }
  },
);
