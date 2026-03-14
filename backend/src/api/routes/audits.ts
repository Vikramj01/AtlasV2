import { Router, Request, Response } from 'express';
import JSZip from 'jszip';
import { authMiddleware } from '@/api/middleware/authMiddleware';
import { auditLimiter } from '@/api/middleware/auditLimiter';
import { createAudit, getAudit, getReport, listAudits, deleteAudit } from '@/services/database/queries';
import { getJourneyWithDetails, getLatestSpec } from '@/services/database/journeyQueries';
import { generatePDF } from '@/services/export/pdfGenerator';
import { auditQueue } from '@/services/queue/jobQueue';
import type { FunnelType, Region } from '@/types/audit';
import logger from '@/utils/logger';
import { validateUrl, validateUrls } from '@/utils/urlValidator';
import { sendInternalError } from '@/utils/apiError';

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

  const websiteUrlResult = validateUrl(website_url);
  if (!websiteUrlResult.valid) {
    res.status(400).json({ error: `Invalid website_url: ${websiteUrlResult.error}` });
    return;
  }

  const mapUrls = Object.values(url_map as Record<string, unknown>).filter((v) => typeof v === 'string');
  const mapUrlError = validateUrls(mapUrls);
  if (mapUrlError) {
    res.status(400).json({ error: `Invalid URL in url_map: ${mapUrlError}` });
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
      // test_email / test_phone are stored in the audits DB row, not the queue
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

// ─── POST /api/audits/start-from-journey ─────────────────────────────────────
// Creates an audit driven by a saved Journey Builder journey + ValidationSpec.

router.post('/start-from-journey', auditLimiter, async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { journey_id, test_email, test_phone } = req.body as {
    journey_id?: string;
    test_email?: string;
    test_phone?: string;
  };

  if (!journey_id) {
    res.status(400).json({ error: 'journey_id is required' });
    return;
  }

  try {
    // Load journey + stages to get the landing URL
    const details = await getJourneyWithDetails(journey_id, user.id);
    if (!details) {
      res.status(404).json({ error: 'Journey not found' });
      return;
    }

    // Load the validation spec
    const specRecord = await getLatestSpec(journey_id, 'validation_spec');
    if (!specRecord) {
      res.status(409).json({ error: 'No validation spec found. Call POST /api/journeys/:id/generate first.' });
      return;
    }

    // Derive the landing URL from the first stage that has a URL
    const firstStage = details.stages.find((s) => s.sample_url);
    const websiteUrl = firstStage?.sample_url ?? 'https://example.com';

    const audit = await createAudit({
      user_id: user.id,
      website_url: websiteUrl,
      funnel_type: 'ecommerce' as FunnelType,
      region: 'us' as Region,
      test_email,
      test_phone,
    });

    await auditQueue.add({
      audit_id: audit.id,
      website_url: websiteUrl,
      funnel_type: 'ecommerce',
      region: 'us',
      url_map: {},
      // test_email / test_phone are stored in the audits DB row, not the queue
      journey_id,
      validation_spec: specRecord.spec_data,
    });

    logger.info({ audit_id: audit.id, journey_id, user_id: user.id }, 'Journey audit queued');

    res.status(202).json({
      audit_id: audit.id,
      journey_id,
      status: 'queued',
      created_at: audit.created_at,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to start journey audit');
    res.status(500).json({ error: 'Failed to start audit' });
  }
});

// ─── GET /api/audits/:audit_id/gaps ─────────────────────────────────────────
// Returns journey gap results for a completed journey-mode audit.
// Also returns planning_context if the journey was created from Planning Mode.

router.get('/:audit_id/gaps', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const audit = await getAudit(req.params.audit_id);
  if (!audit) { res.status(404).json({ error: 'Audit not found' }); return; }
  if (audit.user_id !== user.id) { res.status(403).json({ error: 'Forbidden' }); return; }

  const { supabaseAdmin } = await import('@/services/database/supabase');

  const { data, error } = await supabaseAdmin
    .from('journey_audit_results')
    .select('*')
    .eq('audit_id', req.params.audit_id)
    .order('stage_id');

  if (error) { sendInternalError(res, error); return; }

  const results = data ?? [];

  // ── Planning context: surface what was planned if journey came from Planning Mode ──
  let planning_context: {
    session_id: string;
    website_url: string;
    planned_events: string[];
  } | null = null;

  if (results.length > 0) {
    try {
      const journeyId = (results[0] as { journey_id?: string }).journey_id;
      if (journeyId) {
        const { data: journey } = await supabaseAdmin
          .from('journeys')
          .select('source_planning_session_id')
          .eq('id', journeyId)
          .single();

        if (journey?.source_planning_session_id) {
          const { getApprovedRecommendations, getSession } = await import(
            '@/services/database/planningQueries'
          );
          const [recs, session] = await Promise.all([
            getApprovedRecommendations(journey.source_planning_session_id),
            getSession(journey.source_planning_session_id, user.id).catch(() => null),
          ]);

          if (recs.length > 0) {
            planning_context = {
              session_id: journey.source_planning_session_id,
              website_url: session?.website_url ?? '',
              planned_events: [...new Set(recs.map((r) => r.event_name))],
            };
          }
        }
      }
    } catch {
      // Planning context is best-effort — don't fail the gaps request
    }
  }

  res.json({ results, planning_context });
});

// ─── POST /api/audits/:audit_id/export ───────────────────────────────────────

router.post('/:audit_id/export', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { audit_id } = req.params;
  const format: 'pdf' | 'json' | 'both' = req.body.format ?? 'both';

  if (!['pdf', 'json', 'both'].includes(format)) {
    res.status(400).json({ error: 'format must be pdf, json, or both' });
    return;
  }

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
    res.status(409).json({ error: 'Report not ready', status: audit.status });
    return;
  }

  const report = await getReport(audit_id);
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  try {
    const filename = `atlas-report-${audit_id}`;

    if (format === 'json') {
      const json = JSON.stringify(report, null, 2);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.send(json);
      return;
    }

    if (format === 'pdf') {
      const pdfBuffer = await generatePDF(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      res.send(pdfBuffer);
      return;
    }

    // format === 'both' — bundle PDF + JSON in a ZIP
    const [pdfBuffer] = await Promise.all([generatePDF(report)]);
    const zip = new JSZip();
    zip.file(`${filename}.pdf`, pdfBuffer);
    zip.file(`${filename}.json`, JSON.stringify(report, null, 2));
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
    res.send(zipBuffer);
  } catch (err) {
    logger.error({ err, audit_id }, 'Export failed');
    res.status(500).json({ error: 'Export failed' });
  }
});

// ─── DELETE /api/audits/:audit_id ─────────────────────────────────────────────

router.delete('/:audit_id', async (req: Request, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { audit_id } = req.params;

  const audit = await getAudit(audit_id);
  if (!audit) { res.status(404).json({ error: 'Audit not found' }); return; }
  if (audit.user_id !== user.id) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    await deleteAudit(audit_id, user.id);
    res.json({ deleted: true });
  } catch (err) {
    logger.error({ err, audit_id }, 'Failed to delete audit');
    res.status(500).json({ error: 'Failed to delete audit' });
  }
});

export default router;
