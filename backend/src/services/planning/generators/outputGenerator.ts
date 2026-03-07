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
import { generateDataLayerSpec } from './dataLayerSpecGenerator';
import { generateImplementationGuide } from './implementationGuideGenerator';
import {
  getApprovedRecommendations,
  getPagesBySession,
  createOutput,
  getOutputs,
  updateSessionStatus,
} from '@/services/database/planningQueries';
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

  if (approvedRecs.length === 0) {
    throw new Error('No approved recommendations found. Approve at least one recommendation before generating.');
  }

  // ── 1. GTM Container JSON ─────────────────────────────────────────────────
  logger.info({ sessionId, recCount: approvedRecs.length }, 'Generating GTM container');
  const gtmContainer = generateGTMContainer(approvedRecs, session);
  const gtmJson = JSON.stringify(gtmContainer, null, 2);
  const gtmStoragePath = await uploadOutput(
    sessionId,
    'gtm-container.json',
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

  // ── 3. Implementation Guide HTML ──────────────────────────────────────────
  logger.info({ sessionId }, 'Generating implementation guide');
  const guideHtml = generateImplementationGuide(approvedRecs, pages, session);
  const guideStoragePath = await uploadOutput(
    sessionId,
    'implementation-guide.html',
    guideHtml,
    'text/html',
  ).catch(err => {
    logger.warn({ sessionId, err: err.message }, 'Guide HTML upload failed — storing in DB only');
    return undefined;
  });

  const guideOutput = await createOutput(
    sessionId,
    'implementation_guide',
    null,
    guideHtml,
    'text/html',
    guideStoragePath,
  );

  // ── Update session status ─────────────────────────────────────────────────
  await updateSessionStatus(sessionId, 'outputs_ready');

  logger.info(
    { sessionId, outputIds: [gtmOutput.id, dlOutput.id, guideOutput.id] },
    'Output generation complete → outputs_ready',
  );

  const outputs = await getOutputs(sessionId);
  return { outputs };
}
