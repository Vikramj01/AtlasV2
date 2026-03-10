/**
 * Audit Orchestrator — supports both legacy (funnel_type) and Journey Builder modes.
 */
import type { AuditJobData } from '@/services/queue/jobQueue';
import type { FunnelType, Region } from '@/types/audit';
import type { ValidationSpec } from '@/types/journey';
import { updateAuditStatus, saveValidationResults, saveReport, getAudit } from '@/services/database/queries';
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { simulateJourney } from './journeySimulator';
import { simulateJourneyFromSpec } from './stageSimulator';
import { classifyAllStageGaps } from './gapClassifier';
import { runAllRules, runRulesForPlatforms } from '@/services/validation/engine';
import { calculateScores } from '@/services/scoring/engine';
import { interpretResults } from '@/services/interpretation/engine';
import { generateReport } from '@/services/reporting/generator';
import type { JourneyStage, RuleStatus } from '@/types/audit';
import { getJourneyStages } from '@/services/database/journeyQueries';
import { supabaseAdmin as supabase } from '@/services/database/supabase';
import logger from '@/utils/logger';

export async function runAuditOrchestrator(data: AuditJobData): Promise<void> {
  const { audit_id } = data;

  try {
    await updateAuditStatus(audit_id, 'running', { progress: 5 });
    logger.info({ audit_id, journey_id: data.journey_id }, 'Audit started');

    // Load PII fields from DB rather than reading from the queue payload,
    // so they are never stored in plaintext in Redis.
    const auditRow = await getAudit(audit_id);
    const test_email = auditRow?.test_email;
    const test_phone = auditRow?.test_phone;

    const session = await createBrowserbaseSession();
    await updateAuditStatus(audit_id, 'running', { progress: 10, browserbase_session_id: session.id });

    const { chromium } = require('playwright-core') as {
      chromium: { connectOverCDP: (url: string) => Promise<unknown> };
    };
    const browser = await chromium.connectOverCDP(getCDPUrl(session.id)) as Parameters<typeof simulateJourney>[0];
    await updateAuditStatus(audit_id, 'running', { progress: 15 });

    const isJourneyMode = !!data.journey_id && !!data.validation_spec;

    try {
      if (isJourneyMode) {
        const spec = data.validation_spec as ValidationSpec;

        const stageCaptures = await simulateJourneyFromSpec(
          browser as Parameters<typeof simulateJourneyFromSpec>[0],
          spec,
          test_email,
          test_phone,
        );
        await updateAuditStatus(audit_id, 'running', { progress: 50 });
        logger.info({ audit_id, stages: stageCaptures.length }, 'Stage simulation complete');

        // Classify gaps per stage
        const stageGaps = classifyAllStageGaps(spec, stageCaptures);
        await updateAuditStatus(audit_id, 'running', { progress: 65 });

        // Persist journey_audit_results
        if (data.journey_id) {
          const dbStages = await getJourneyStages(data.journey_id).catch(() => []);
          for (const gapResult of stageGaps) {
            const dbStage = dbStages.find((s) => s.stage_order === gapResult.stage_order);
            if (!dbStage) continue;
            const { error: insertErr } = await supabase.from('journey_audit_results').insert({
              audit_id,
              journey_id: data.journey_id,
              stage_id: dbStage.id,
              stage_status: gapResult.stage_status,
              gaps: gapResult.gaps,
              raw_capture: null,
            });
            if (insertErr) logger.warn({ err: insertErr.message }, 'Failed to save gap result');
          }
        }

        // Run rules over the combined capture, filtered to selected platforms only
        const combinedDL = stageCaptures.flatMap((c) => c.datalayer_events);
        const combinedNet = stageCaptures.flatMap((c) => c.network_requests);
        const firstCapture = stageCaptures.find((c) => !c.skipped);

        // Extract the active platforms from the ValidationSpec so only
        // relevant rules are scored (deselected platforms won't count against score)
        const activePlatforms = [
          ...new Set(
            spec.stages
              .flatMap((s) => s.expected_platforms)
              .map((p) => p.platform),
          ),
        ];

        const proxyAuditData = {
          audit_id,
          website_url: data.website_url || stageCaptures[0]?.url_navigated || '',
          funnel_type: 'ecommerce' as FunnelType,
          region: (data.region ?? 'us') as Region,
          dataLayer: combinedDL,
          networkRequests: combinedNet,
          cookieSnapshots: [],
          localStorageSnapshots: [],
          injected: { gclid: '', fbclid: '' },
          test_email: test_email,
          test_phone: test_phone,
          urlParams: {},
          storage: firstCapture?.local_storage ?? {},
          cookies: firstCapture?.cookies ?? {},
          pageMetadata: { pixel_fbclid: false },
        };

        const validationResults = activePlatforms.length > 0
          ? runRulesForPlatforms(activePlatforms, proxyAuditData)
          : runAllRules(proxyAuditData);
        await saveValidationResults(audit_id, validationResults);
        await updateAuditStatus(audit_id, 'running', { progress: 80 });

        // Build journey-specific stage breakdown from gap classifier results
        const stageStatusMap: Record<string, RuleStatus> = {
          healthy: 'pass',
          issues_found: 'warning',
          signals_missing: 'fail',
          not_checked: 'pass',
        };
        const customJourneyStages: JourneyStage[] = stageGaps.map((sg) => ({
          stage: sg.stage_label,
          status: stageStatusMap[sg.stage_status] ?? 'pass',
          issues: sg.gaps.map((g) => `${g.gap_type.replace(/_/g, ' ')} — ${g.business_impact}`),
        }));

        const scores = calculateScores(validationResults);
        const issues = interpretResults(validationResults);
        const report = generateReport(proxyAuditData, scores, issues, validationResults, customJourneyStages);
        await saveReport(audit_id, report);

      } else {
        // Legacy mode
        const auditData = await simulateJourney(browser, {
          audit_id,
          website_url: data.website_url,
          funnel_type: data.funnel_type as FunnelType,
          region: (data.region ?? 'us') as Region,
          url_map: data.url_map,
          test_email: test_email,
          test_phone: test_phone,
        });
        await updateAuditStatus(audit_id, 'running', { progress: 50 });
        logger.info({ audit_id, events: auditData.dataLayer.length }, 'Journey simulation complete');

        const validationResults = runAllRules(auditData);
        await saveValidationResults(audit_id, validationResults);
        await updateAuditStatus(audit_id, 'running', { progress: 75 });

        const scores = calculateScores(validationResults);
        const issues = interpretResults(validationResults);
        const report = generateReport(auditData, scores, issues, validationResults);
        await saveReport(audit_id, report);
      }
    } finally {
      try { await (browser as { close?: () => Promise<void> }).close?.(); } catch { /* ignore */ }
    }

    await updateAuditStatus(audit_id, 'completed', {
      progress: 100,
      completed_at: new Date().toISOString(),
    });
    logger.info({ audit_id }, 'Audit completed');

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ audit_id, err: message }, 'Audit failed');
    await updateAuditStatus(audit_id, 'failed', { error_message: message }).catch(() => {});
    throw err;
  }
}
