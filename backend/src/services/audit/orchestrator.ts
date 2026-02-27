/**
 * Audit Orchestrator
 * Drives the full audit pipeline for a single job:
 *   1. Update status → running
 *   2. Create Browserbase session + run journey simulator
 *   3. Run all 26 validation rules
 *   4. Calculate scores
 *   5. Interpret results
 *   6. Generate + persist report JSON
 *   7. Update status → completed (or failed)
 */
import type { AuditJobData } from '@/services/queue/jobQueue';
import type { FunnelType, Region } from '@/types/audit';
import { updateAuditStatus, saveValidationResults, saveReport } from '@/services/database/queries';
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { simulateJourney } from './journeySimulator';
import { runAllRules } from '@/services/validation/engine';
import { calculateScores } from '@/services/scoring/engine';
import { interpretResults } from '@/services/interpretation/engine';
import { generateReport } from '@/services/reporting/generator';
import logger from '@/utils/logger';

export async function runAuditOrchestrator(data: AuditJobData): Promise<void> {
  const { audit_id } = data;

  try {
    // ── Step 1: Mark running ───────────────────────────────────────────────
    await updateAuditStatus(audit_id, 'running', { progress: 5 });
    logger.info({ audit_id }, 'Audit started');

    // ── Step 2: Create Browserbase session ────────────────────────────────
    const session = await createBrowserbaseSession();
    await updateAuditStatus(audit_id, 'running', {
      progress: 10,
      browserbase_session_id: session.id,
    });

    // ── Step 3: Connect Playwright and simulate journey ───────────────────
    // Lazy-require playwright-core to avoid requiring it for unit tests
    const { chromium } = require('playwright-core') as {
      chromium: { connectOverCDP: (url: string) => Promise<unknown> };
    };

    const cdpUrl = getCDPUrl(session.id);
    const browser = await chromium.connectOverCDP(cdpUrl) as Parameters<typeof simulateJourney>[0];

    await updateAuditStatus(audit_id, 'running', { progress: 15 });

    let auditData;
    try {
      auditData = await simulateJourney(browser, {
        audit_id,
        website_url: data.website_url,
        funnel_type: data.funnel_type as FunnelType,
        region: (data.region ?? 'us') as Region,
        url_map: data.url_map,
        test_email: data.test_email,
        test_phone: data.test_phone,
      });
    } finally {
      try {
        await (browser as { close?: () => Promise<void> }).close?.();
      } catch { /* ignore browser close errors */ }
    }

    await updateAuditStatus(audit_id, 'running', { progress: 50 });
    logger.info({ audit_id, dataLayerEvents: auditData.dataLayer.length, networkRequests: auditData.networkRequests.length }, 'Journey simulation complete');

    // ── Step 4: Run all 26 validation rules ───────────────────────────────
    const validationResults = runAllRules(auditData);
    await updateAuditStatus(audit_id, 'running', { progress: 65 });

    // ── Step 5: Persist validation results ────────────────────────────────
    await saveValidationResults(audit_id, validationResults);
    await updateAuditStatus(audit_id, 'running', { progress: 75 });

    // ── Step 6: Score + interpret ─────────────────────────────────────────
    const scores = calculateScores(validationResults);
    const issues = interpretResults(validationResults);
    await updateAuditStatus(audit_id, 'running', { progress: 85 });

    // ── Step 7: Generate + persist report ────────────────────────────────
    const report = generateReport(auditData, scores, issues, validationResults);
    await saveReport(audit_id, report);

    // ── Step 8: Mark completed ────────────────────────────────────────────
    await updateAuditStatus(audit_id, 'completed', {
      progress: 100,
      completed_at: new Date().toISOString(),
    });

    logger.info(
      {
        audit_id,
        signal_health: scores.conversion_signal_health,
        attribution_risk: scores.attribution_risk_level,
        issues: issues.length,
      },
      'Audit completed successfully',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ audit_id, err: message }, 'Audit failed');

    await updateAuditStatus(audit_id, 'failed', {
      error_message: message,
    }).catch(() => {});

    throw err;
  }
}
