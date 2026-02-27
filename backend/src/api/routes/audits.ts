import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { auditLimiter } from '@/api/middleware/auditLimiter';
import { createAudit, getAudit, getReport, listAudits } from '@/services/database/queries';
import { auditQueue } from '@/services/queue/jobQueue';
import type { FunnelType, Region } from '@/types/audit';
import logger from '@/utils/logger';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    plan: 'free' | 'pro' | 'agency';
  };
}

const router = Router();

// All audit routes require authentication
router.use(authMiddleware);

// ─── GET /api/audits ─────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  try {
    const audits = await listAudits(user.id);
    res.json(audits);
  } catch (err) {
    logger.error({ err }, 'Failed to list audits');
    res.status(500).json({ error: 'Failed to fetch audits' });
  }
});

// ─── POST /api/audits/start ───────────────────────────────────────────────────

router.post('/start', auditLimiter, async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { website_url, funnel_type, region, url_map, test_email, test_phone } = req.body;

  if (!website_url || !funnel_type || !url_map) {
    res.status(400).json({ error: 'website_url, funnel_type, and url_map are required' });
    return;
  }

  const validFunnelTypes: FunnelType[] = ['ecommerce', 'saas', 'lead_gen'];
  if (!validFunnelTypes.includes(funnel_type)) {
    res.status(400).json({ error: `funnel_type must be one of: ${validFunnelTypes.join(', ')}` });
    return;
  }

  try {
    const audit = await createAudit({
      user_id: user.id,
      website_url,
      funnel_type: funnel_type as FunnelType,
      region: (region ?? 'us') as Region,
      test_email,
      test_phone,
    });

    await auditQueue.add({
      audit_id: audit.id,
      website_url,
      funnel_type,
      region: region ?? 'us',
      url_map,
      test_email,
      test_phone,
    });

    logger.info({ audit_id: audit.id, user_id: user.id }, 'Audit queued');

    res.status(202).json({
      audit_id: audit.id,
      status: 'queued',
      created_at: audit.created_at,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start audit');
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

// ─── GET /api/audits/:audit_id ────────────────────────────────────────────────

router.get('/:audit_id', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { audit_id } = req.params;

  const audit = await getAudit(audit_id);

  if (!audit) {
    res.status(404).json({ error: 'Audit not found' });
    return;
  }

  if (audit.user_id !== user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.json({
    audit_id: audit.id,
    status: audit.status,
    progress: audit.progress,
    created_at: audit.created_at,
    completed_at: audit.completed_at ?? null,
    error: audit.error_message ?? null,
  });
});

// ─── GET /api/audits/:audit_id/report ────────────────────────────────────────

router.get('/:audit_id/report', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { audit_id } = req.params;

  const audit = await getAudit(audit_id);

  if (!audit) {
    res.status(404).json({ error: 'Audit not found' });
    return;
  }

  if (audit.user_id !== user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  if (audit.status !== 'completed') {
    res.status(409).json({
      error: 'Report not ready',
      status: audit.status,
      progress: audit.progress,
    });
    return;
  }

  const report = await getReport(audit_id);

  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  res.json(report);
});

// ─── POST /api/audits/:audit_id/export ───────────────────────────────────────
// Stub — implemented in Sprint 6

router.post('/:audit_id/export', async (req: Request, res: Response) => {
  res.status(501).json({ error: 'Export not yet implemented' });
});

export default router;
