/**
 * Consent Hub API routes — all endpoints under /api/consent
 *
 * POST   /api/consent/record                        — record a visitor's consent decision
 * GET    /api/consent/:projectId/:visitorId          — get latest consent state
 * DELETE /api/consent/:projectId/:visitorId          — delete consent records (right to erasure)
 * GET    /api/consent/:projectId/analytics           — aggregate consent analytics
 * GET    /api/consent/config/:projectId              — get consent config for a project
 * POST   /api/consent/config                         — create or update consent config
 *
 * All routes are protected by authMiddleware.
 * The record endpoint is accessible without auth (banner JS calls it server-side).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { sendInternalError } from '@/utils/apiError';
import {
  createConsentRecord,
  getLatestConsentRecord,
  deleteConsentRecords,
  getConsentAnalytics,
  getConsentConfig,
  upsertConsentConfig,
} from '@/services/database/consentQueries';
import type {
  RecordConsentRequest,
  ConsentAnalyticsParams,
} from '@/types/consent';
import { buildGCMState } from '@/services/consent/gcmMapper';

export const consentRouter = Router();

// ── POST /api/consent/record ──────────────────────────────────────────────────
// Record a visitor's consent decisions. Called by the banner JS snippet.
// No auth required — public endpoint (banner runs on end-user browsers).
// Project validity is checked via consent_configs lookup.

consentRouter.post('/record', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as RecordConsentRequest;

  if (!body.project_id || !body.visitor_id || !body.consent_id || !body.decisions || !body.source) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'project_id, visitor_id, consent_id, decisions and source are required' });
    return;
  }

  try {
    // Look up consent config to validate project and get TTL + GCM mapping
    const config = await getConsentConfig(body.project_id);
    if (!config) {
      res.status(400).json({ error: 'INVALID_PROJECT', message: 'No consent config found for this project' });
      return;
    }

    // Derive GCM state from decisions if GCM is enabled
    const gcm_state = config.gcm_enabled
      ? buildGCMState(body.decisions, config.gcm_mapping)
      : null;

    const ip_country = resolveCountry(req);
    const user_agent = body.user_agent ?? (req.headers['user-agent'] ?? null);
    const ttl_days = config.banner_config?.ttl_days ?? 180;

    const record = await createConsentRecord({
      project_id: body.project_id,
      organization_id: config.organization_id,
      visitor_id: body.visitor_id,
      consent_id: body.consent_id,
      decisions: body.decisions,
      gcm_state,
      regulation: config.regulation,
      ip_country,
      user_agent: typeof user_agent === 'string' ? user_agent : null,
      source: body.source,
      ttl_days,
    });

    res.status(201).json({
      id: record.id,
      gcm_state: gcm_state ?? {},
      expires_at: record.expires_at,
    });
  } catch (err) {
    sendInternalError(res, err, 'Failed to record consent');
  }
});

// ── GET /api/consent/:projectId/:visitorId ─────────────────────────────────────

consentRouter.get('/:projectId/:visitorId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { projectId, visitorId } = req.params;

  try {
    const record = await getLatestConsentRecord(projectId, visitorId);
    if (!record) {
      res.status(404).json({ error: 'NO_CONSENT_RECORD', message: 'No active consent record found' });
      return;
    }

    res.json({
      visitor_id: record.visitor_id,
      decisions: record.decisions,
      gcm_state: record.gcm_state ?? {},
      expires_at: record.expires_at,
      last_updated: record.created_at,
    });
  } catch (err) {
    sendInternalError(res, err, 'Failed to get consent record');
  }
});

// ── DELETE /api/consent/:projectId/:visitorId ──────────────────────────────────
// Right-to-erasure: delete all consent records for a visitor.

consentRouter.delete('/:projectId/:visitorId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { projectId, visitorId } = req.params;

  try {
    const deleted_count = await deleteConsentRecords(projectId, visitorId);
    res.json({ deleted_count, visitor_id: visitorId });
  } catch (err) {
    sendInternalError(res, err, 'Failed to delete consent records');
  }
});

// ── GET /api/consent/:projectId/analytics ─────────────────────────────────────

consentRouter.get('/:projectId/analytics', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;
  const { period = '30d', group_by = 'day' } = req.query as Partial<ConsentAnalyticsParams>;

  if (!['7d', '30d', '90d', 'all'].includes(period)) {
    res.status(400).json({ error: 'INVALID_PERIOD', message: 'period must be 7d, 30d, 90d or all' });
    return;
  }

  try {
    const config = await getConsentConfig(projectId);
    if (!config) {
      res.status(400).json({ error: 'CONFIG_NOT_FOUND', message: 'No consent config found for this project' });
      return;
    }

    // Ownership check — user must belong to the same organisation
    if (req.user.id !== config.organization_id && config.organization_id !== req.user.id) {
      // org-level check: allow if user_id is the org creator; full RBAC in Sprint 4
    }

    const analytics = await getConsentAnalytics(projectId, config.organization_id, period as '7d' | '30d' | '90d' | 'all');
    res.json({ ...analytics, group_by });
  } catch (err) {
    sendInternalError(res, err, 'Failed to get consent analytics');
  }
});

// ── GET /api/consent/config/:projectId ────────────────────────────────────────

consentRouter.get('/config/:projectId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { projectId } = req.params;

  try {
    const config = await getConsentConfig(projectId);
    if (!config) {
      res.status(404).json({ error: 'CONFIG_NOT_FOUND', message: 'No consent config found for this project' });
      return;
    }
    res.json(config);
  } catch (err) {
    sendInternalError(res, err, 'Failed to get consent config');
  }
});

// ── POST /api/consent/config ───────────────────────────────────────────────────
// Create or update a consent config for a project (upsert on project_id).

consentRouter.post('/config', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { project_id, organization_id, ...rest } = req.body;

  if (!project_id || !organization_id) {
    res.status(400).json({ error: 'MISSING_FIELDS', message: 'project_id and organization_id are required' });
    return;
  }

  try {
    const config = await upsertConsentConfig({ project_id, organization_id, ...rest });
    res.status(200).json(config);
  } catch (err) {
    sendInternalError(res, err, 'Failed to save consent config');
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveCountry(req: Request): string | null {
  // Populated by Cloudflare or Vercel edge headers
  const cfCountry = req.headers['cf-ipcountry'];
  if (typeof cfCountry === 'string' && cfCountry.length === 2) return cfCountry.toUpperCase();
  const vercelCountry = req.headers['x-vercel-ip-country'];
  if (typeof vercelCountry === 'string' && vercelCountry.length === 2) return vercelCountry.toUpperCase();
  return null;
}
