/**
 * Output Generator Orchestrator
 *
 * Calls all three generators in sequence, persists results to the DB, and
 * uploads files to Supabase Storage. Updates session status to 'outputs_ready'.
 *
 * After generation, runs the GenerationValidator. CRITICAL errors block
 * delivery and throw GenerationValidationError. HIGH errors are included in
 * the result as warnings and surfaced to the user in the UI.
 *
 * Called synchronously from the /generate API endpoint (not a background job).
 * Total generation time: ~1–3 seconds for typical sessions.
 */
import { generateGTMContainer } from './gtmContainerGenerator';
import type { GTMPlatformIds } from './gtmContainerGenerator';
import { generateDataLayerSpec } from './dataLayerSpecGenerator';
import { generateDeveloperHandoffDoc } from './developerHandoffDoc';
import { validateGeneration } from './validator/generation.validator';
import type { ValidationResult } from './validator/validator.types';
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

// ── Error type for CRITICAL validation failures ───────────────────────────────

export class GenerationValidationError extends Error {
  readonly validationResult: ValidationResult;

  constructor(result: ValidationResult) {
    const criticalCount = result.errors.filter(e => e.severity === 'CRITICAL').length;
    super(
      `Output generation blocked: ${criticalCount} CRITICAL validation error(s) detected. ` +
      `Deliver atlas-output-quality fixes before retrying.`,
    );
    this.name = 'GenerationValidationError';
    this.validationResult = result;
  }
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface GenerateOutputsResult {
  outputs: PlanningOutput[];
  /** Present when validation ran — always included even if passed: true */
  validationResult?: ValidationResult;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

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

  // ── 2. DataLayer Specification ────────────────────────────────────────────
  logger.info({ sessionId }, 'Generating dataLayer spec');
  const dlSpec = generateDataLayerSpec(approvedRecs, pages, session);

  // ── 3. Developer Handoff Document (Markdown) ─────────────────────────────
  logger.info({ sessionId }, 'Generating developer handoff doc');
  const handoffMd = generateDeveloperHandoffDoc(approvedRecs, pages, session);

  // ── Validate before delivery ──────────────────────────────────────────────
  logger.info({ sessionId }, 'Running GenerationValidator');
  const validationResult = validateGeneration({
    gtmContainer,
    dataLayerSpec: dlSpec,
    implementationGuide: handoffMd,
    recommendations: approvedRecs,
    businessType: session.business_type,
    platforms: session.selected_platforms,
  });

  const criticalErrors = validationResult.errors.filter(e => e.severity === 'CRITICAL');

  logger.info(
    {
      sessionId,
      passed: validationResult.passed,
      criticalErrors: criticalErrors.length,
      highErrors: validationResult.errors.filter(e => e.severity === 'HIGH').length,
      warnings: validationResult.warnings.length,
    },
    'GenerationValidator complete',
  );

  if (criticalErrors.length > 0) {
    // Log each critical error for operator visibility before throwing
    for (const err of criticalErrors) {
      logger.error(
        { sessionId, rule: err.rule, location: err.location },
        `GenerationValidator CRITICAL: ${err.message}`,
      );
    }
    throw new GenerationValidationError(validationResult);
  }

  // Log HIGH errors as warnings — delivery continues but these surface to the user
  for (const err of validationResult.errors.filter(e => e.severity === 'HIGH')) {
    logger.warn(
      { sessionId, rule: err.rule, location: err.location },
      `GenerationValidator HIGH: ${err.message}`,
    );
  }

  // ── Derive a slug from the site URL for the versioned filename ────────────
  const siteSlug = session.website_url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);

  const gtmJson = JSON.stringify(gtmContainer, null, 2);

  // ── Persist GTM container ─────────────────────────────────────────────────
  const gtmStoragePath = await uploadOutput(
    sessionId,
    `gtm-container.json`,
    gtmJson,
    'application/json',
  ).catch(err => {
    logger.warn({ sessionId, err: (err as Error).message }, 'GTM JSON upload failed — storing in DB only');
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

  // ── Persist DataLayer Spec ────────────────────────────────────────────────
  const dlOutput = await createOutput(
    sessionId,
    'datalayer_spec',
    dlSpec,
    null,
    'application/json',
  );

  // ── Persist Developer Handoff Document ────────────────────────────────────
  const guideStoragePath = await uploadOutput(
    sessionId,
    'developer-handoff.md',
    handoffMd,
    'text/markdown',
  ).catch(err => {
    logger.warn({ sessionId, err: (err as Error).message }, 'Handoff doc upload failed — storing in DB only');
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
  return { outputs, validationResult };
}
