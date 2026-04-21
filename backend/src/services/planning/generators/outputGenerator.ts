/**
 * Output Generator Orchestrator
 *
 * Calls all three generators in sequence, persists results to the DB, and
 * uploads files to Supabase Storage. Updates session status to 'outputs_ready'.
 *
 * Called synchronously from the /generate API endpoint (not a background job).
 * Total generation time: ~1–3 seconds for typical sessions.
 */
import { generateGTMContainer } from './gtmContainerGenerator';
import type { GTMPlatformIds } from './gtmContainerGenerator';
import { generateDataLayerSpec } from './dataLayerSpecGenerator';
import { generateDeveloperHandoffDoc } from './developerHandoffDoc';
import {
  getApprovedRecommendations,
  getPagesBySession,
  createOutput,
  getOutputs,
  updateSessionStatus,
  saveTrackingPlanVersion,
} from '@/services/database/planningQueries';
import { getClientPlatforms } from '@/services/database/clientQueries';
import { uploadOutput } from '@/services/database/supabase';
import type { PlanningSession, PlanningOutput } from '@/types/planning';
import logger from '@/utils/logger';

export interface GenerateOutputsResult {
  outputs: PlanningOutput[];
}

export async function generateAllOutputs(session: PlanningSession): Promise<GenerateOutputsResult> {
  const sessionId = session.id;

  logger.info({ sessionId }, 'Starting output generation');

  // ── Load data ─────────────────────────────────────────────────────────────
  const [approvedRecs, pages] = await Promise.all([
    getApprovedRecommendations(sessionId),
    getPagesBySession(sessionId),
  ]);

  // ── Resolve platform IDs from linked client (if any) ─────────────────────
  let platformIds: GTMPlatformIds | undefined;
  if (session.client_id) {
    try {
      const clientPlatforms = await getClientPlatforms(session.client_id);
      platformIds = {};
      for (const p of clientPlatforms) {
        if (!p.is_active || !p.measurement_id) continue;
        if (p.platform === 'ga4')        platformIds.ga4         = p.measurement_id;
        if (p.platform === 'google_ads') platformIds.google_ads  = p.measurement_id;
        if (p.platform === 'meta')       platformIds.meta        = p.measurement_id;
        if (p.platform === 'tiktok')     platformIds.tiktok      = p.measurement_id;
        if (p.platform === 'linkedin')   platformIds.linkedin    = p.measurement_id;
      }
      logger.info({ sessionId, clientId: session.client_id, platformIds }, 'Resolved platform IDs from client');
    } catch (err) {
      logger.warn({ sessionId, err: (err as Error).message }, 'Failed to fetch client platform IDs — using placeholders');
    }
  }

  if (approvedRecs.length === 0) {
    throw new Error('No approved recommendations found. Approve at least one recommendation before generating.');
  }

  // ── 1. GTM Container JSON ─────────────────────────────────────────────────
  logger.info({ sessionId, recCount: approvedRecs.length }, 'Generating GTM container');
  const gtmContainer = generateGTMContainer(approvedRecs, session, platformIds);
  const gtmJson = JSON.stringify(gtmContainer, null, 2);

  // Derive a slug from the site URL for the versioned filename
  const siteSlug = session.website_url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);

  const gtmStoragePath = await uploadOutput(
    sessionId,
    `gtm-container.json`,
    gtmJson,
    'application/json',
  ).catch(err => {
    logger.warn({ sessionId, err: err.message }, 'GTM JSON upload failed — storing in DB only');
    return undefined;
  });

  const gtmOutput = await createOutput(
    sessionId,
    'gtm_container',
    gtmContainer,
    null,
    'application/json',
    gtmStoragePath,
  );

  // Attach slug + version to the container for the frontend download filename
  (gtmContainer as unknown as Record<string, unknown>)['_atlas_meta'] = {
    site_slug: siteSlug,
    version: gtmOutput.version,
  };

  // ── 2. DataLayer Specification ────────────────────────────────────────────
  logger.info({ sessionId }, 'Generating dataLayer spec');
  const dlSpec = generateDataLayerSpec(approvedRecs, pages, session);
  const dlOutput = await createOutput(
    sessionId,
    'datalayer_spec',
    dlSpec,
    null,
    'application/json',
  );

  // ── 3. Developer Handoff Document (Markdown) ─────────────────────────────
  logger.info({ sessionId }, 'Generating developer handoff doc');
  const handoffMd = generateDeveloperHandoffDoc(approvedRecs, pages, session);
  const guideStoragePath = await uploadOutput(
    sessionId,
    'developer-handoff.md',
    handoffMd,
    'text/markdown',
  ).catch(err => {
    logger.warn({ sessionId, err: err.message }, 'Handoff doc upload failed — storing in DB only');
    return undefined;
  });

  const guideOutput = await createOutput(
    sessionId,
    'implementation_guide',
    null,
    handoffMd,
    'text/markdown',
    guideStoragePath,
  );

  // ── Update session status ─────────────────────────────────────────────────
  await updateSessionStatus(sessionId, 'outputs_ready');

  // ── Save version snapshot (non-blocking) ─────────────────────────────────
  saveTrackingPlanVersion(
    sessionId,
    gtmOutput.id,
    dlOutput.id,
    guideOutput.id,
    gtmOutput.version,
  ).catch(() => { /* non-blocking */ });

  logger.info(
    { sessionId, version: gtmOutput.version, outputIds: [gtmOutput.id, dlOutput.id, guideOutput.id] },
    'Output generation complete → outputs_ready',
  );

  const outputs = await getOutputs(sessionId);
  return { outputs };
}
