/**
 * Audit Orchestrator — supports both legacy (funnel_type) and Journey Builder modes.
 */
import type { AuditJobData } from '@/services/queue/jobQueue';
import type { FunnelType, Region } from '@/types/audit';
import type { ValidationSpec } from '@/types/journey';
import { updateAuditStatus, saveValidationResults, saveReport, getAudit, updateAuditCoverage } from '@/services/database/queries';
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { logUsage } from '@/services/usage/usageLogger';
import { supabaseAdmin as supabase } from '@/services/database/supabase';
import { simulateJourney } from './journeySimulator';
import { resolveStepUrls } from './stepUrlResolver';
import { JOURNEY_CONFIGS } from '@/services/browserbase/journeyConfigs';
import { simulateJourneyFromSpec } from './stageSimulator';
import { classifyAllStageGaps } from './gapClassifier';
import { runAllRules, runRulesForPlatforms } from '@/services/validation/engine';
import { calculateScores } from '@/services/scoring/engine';
import { runRegister } from '@/services/validation/register/engine';
import { calculateV2Scores } from '@/services/validation/register/scoring';
import { buildV2LayerStages, buildV2PlatformBreakdown } from '@/services/validation/register/reporting';
import { interpretResults } from '@/services/interpretation/engine';
import { generateReport } from '@/services/reporting/generator';
import { computeCoverageFingerprint } from '@/services/reporting/coverage';
import { getConnectedGtmContainerId } from '@/services/database/gtmConnectionQueries';
import { getNamingConvention } from '@/services/database/namingConventionQueries';
import { buildSiteSetupSummary } from './siteSetupDetector';
import { sanitizeForJsonb } from '@/utils/sanitizeJsonb';
import type { AuditData, JourneyStage, RuleStatus, StepUrlSource } from '@/types/audit';
import { getJourneyStages } from '@/services/database/journeyQueries';
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

    // Resolve the client's connected GTM container ID, if any, for the Site
    // Setup live-vs-connected mismatch check (non-fatal if it fails).
    let connectedGtmContainerId: string | null = null;
    if (auditRow?.client_id) {
      try {
        connectedGtmContainerId = await getConnectedGtmContainerId(auditRow.client_id);
      } catch (err) {
        logger.warn({ audit_id, err: err instanceof Error ? err.message : String(err) }, 'Failed to resolve connected GTM container');
      }
    }

    // Resolve org_id for usage logging and (for a v2 audit) the org's Naming
    // Conventions config (non-fatal if it fails).
    //
    // organization_id (American spelling) — not organisation_id, which this
    // query used before. profiles.organization_id is the actively-maintained
    // column (see 20260702_001_fix_profiles_organization_id.sql); the rest
    // of the codebase already selects organization_id here (e.g.
    // audits.ts's resolveOrgId). The British spelling column was never
    // populated for most users, so this resolution — and Browserbase usage
    // logging, which depends on it below — was silently returning undefined
    // org_id for most audits.
    let orgId: string | undefined;
    if (auditRow?.user_id) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', auditRow.user_id)
          .single();
        orgId = (profile as { organization_id: string } | null)?.organization_id ?? undefined;
      } catch {
        // Non-fatal — usage logging degrades gracefully without org_id
      }
    }

    const scanRunId = crypto.randomUUID();
    const sessionStart = Date.now();

    const session = await createBrowserbaseSession(
      orgId
        ? { org_id: orgId, audit_id, scan_run_id: scanRunId }
        : undefined,
    );
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
              gaps: sanitizeForJsonb(gapResult.gaps),
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
          not_checked: 'not_run',
        };
        const customJourneyStages: JourneyStage[] = stageGaps.map((sg) => ({
          stage: sg.stage_label,
          status: stageStatusMap[sg.stage_status] ?? 'not_run',
          // business_impact is already a full plain-language sentence (see
          // gapClassifier.ts) — use it directly as the label rather than
          // prefixing a raw action_key/platform token soup.
          issues: sg.gaps.map((g) => ({
            rule_id: `${g.action_key}_${g.platform}_${g.sub_type}`.toUpperCase(),
            label: g.business_impact,
          })),
        }));

        const combinedGtmScriptSrcs = stageCaptures.flatMap((c) => c.gtm_script_srcs ?? []);
        const siteSetup = buildSiteSetupSummary(proxyAuditData, combinedGtmScriptSrcs, connectedGtmContainerId);

        const scores = calculateScores(validationResults);
        const issues = interpretResults(validationResults);
        const report = generateReport(proxyAuditData, scores, issues, validationResults, siteSetup, customJourneyStages);
        await saveReport(audit_id, report);

      } else {
        // Funnel-type (v1) / site-type (v2) mode — dispatched by the audit
        // row's rule_set_version, resolved from the DB rather than trusted
        // from the job payload alone (audits.ts already sets it correctly,
        // but the row is the source of truth).
        const isV2 = auditRow?.rule_set_version === 'v2';

        // Naming Conventions (L5.13) — only meaningful for v2, and only
        // resolvable when org_id resolved above; getNamingConvention
        // already defaults internally when the org never configured one,
        // so this never blocks a scan on a missing config.
        let namingConvention: Awaited<ReturnType<typeof getNamingConvention>> | undefined;
        if (isV2 && orgId) {
          try {
            namingConvention = await getNamingConvention(orgId);
          } catch (err) {
            logger.warn({ audit_id, err: err instanceof Error ? err.message : String(err) }, 'Failed to resolve naming convention');
          }
        }

        // Page discovery (Phase 2, §7) — from the bare website_url, try to
        // resolve the funnel template's step keys the caller didn't
        // already supply a URL for. v2-only: v1's rule library has no
        // step-coverage-driven precondition gate to benefit from the extra
        // Browserbase-adjacent latency this costs, so there's nothing for
        // it to improve there. Only fills gaps — never overrides a
        // user-supplied url_map entry (§15.6).
        let resolvedUrlMap = data.url_map;
        let resolvedSources: Record<string, StepUrlSource> | undefined;
        if (isV2) {
          try {
            const stepKeys = (JOURNEY_CONFIGS[data.funnel_type as FunnelType] ?? JOURNEY_CONFIGS['ecommerce']).map((s) => s.urlKey);
            const resolved = await resolveStepUrls({
              website_url: data.website_url,
              step_keys: stepKeys,
              url_map: data.url_map,
              product_domain: data.product_domain,
              checkout_domain: data.checkout_domain,
            });
            if (Object.keys(resolved).length > 0) {
              resolvedUrlMap = { ...data.url_map };
              resolvedSources = {};
              for (const [key, { url, source }] of Object.entries(resolved)) {
                resolvedUrlMap[key] = url;
                resolvedSources[key] = source;
              }
              logger.info({ audit_id, resolved: Object.keys(resolved) }, 'Step URL resolution filled gaps in url_map');
            }
          } catch (err) {
            // Non-fatal — an unresolved key just stays fallback_landing, same as if this had never run.
            logger.warn({ audit_id, err: err instanceof Error ? err.message : String(err) }, 'Step URL resolution failed');
          }
        }

        const auditData = await simulateJourney(browser, {
          audit_id,
          website_url: data.website_url,
          funnel_type: data.funnel_type as FunnelType,
          region: (data.region ?? 'us') as Region,
          url_map: resolvedUrlMap,
          resolved_sources: resolvedSources,
          test_email: test_email,
          test_phone: test_phone,
          product_domain: data.product_domain,
          checkout_domain: data.checkout_domain,
          connected_gtm_container_id: connectedGtmContainerId ?? undefined,
          ...(isV2 && {
            rule_set_version: data.rule_set_version as AuditData['rule_set_version'],
            site_type: data.site_type as AuditData['site_type'],
            secondary_motion: data.secondary_motion as AuditData['secondary_motion'],
            declared_platforms: data.declared_platforms as AuditData['declared_platforms'],
            primary_channel: data.primary_channel as AuditData['primary_channel'],
            monthly_spend_band: data.monthly_spend_band,
            traffic_regions: data.traffic_regions as AuditData['traffic_regions'],
            cmp: data.cmp as AuditData['cmp'],
            additional_properties: data.additional_properties,
            declared_conversions: data.declared_conversions,
            namingConvention,
          }),
        });
        await updateAuditStatus(audit_id, 'running', { progress: 50 });
        logger.info({ audit_id, events: auditData.dataLayer.length, rule_set_version: isV2 ? 'v2' : 'v1-legacy' }, 'Journey simulation complete');

        const validationResults = isV2 ? runRegister(auditData) : runAllRules(auditData);
        await saveValidationResults(audit_id, validationResults);
        await updateAuditStatus(audit_id, 'running', { progress: 75 });

        const siteSetup = buildSiteSetupSummary(auditData, (auditData.pageMetadata?.gtm_script_srcs as string[]) ?? [], connectedGtmContainerId);

        const scores = isV2 ? calculateV2Scores(validationResults) : calculateScores(validationResults);
        const issues = interpretResults(validationResults);
        const customJourneyStages = isV2 ? buildV2LayerStages(validationResults) : undefined;
        const customPlatformBreakdown = isV2 ? buildV2PlatformBreakdown(validationResults, auditData.declared_platforms) : undefined;
        const report = generateReport(auditData, scores, issues, validationResults, siteSetup, customJourneyStages, customPlatformBreakdown);
        await saveReport(audit_id, report);

        // coverage_fingerprint/pages_distinct (§9) — persisted for every
        // audit, not just v2: step_coverage itself is captured
        // unconditionally by simulateJourney, so there's no reason to
        // special-case this write. Undefined for an AuditData with no
        // step_coverage (Journey-Builder mode never reaches this branch
        // anyway) simply persists as null.
        try {
          await updateAuditCoverage(audit_id, {
            coverage_fingerprint: computeCoverageFingerprint(auditData),
            pages_distinct: report.executive_summary.coverage?.pages_distinct,
          });
        } catch (err) {
          logger.warn({ audit_id, err: err instanceof Error ? err.message : String(err) }, 'Failed to persist audit coverage fingerprint');
        }
      }
    } finally {
      try { await (browser as { close?: () => Promise<void> }).close?.(); } catch { /* ignore */ }
    }

    // Log Browserbase usage for this audit session (fire-and-forget).
    if (orgId) {
      const browserMinutes = (Date.now() - sessionStart) / 60_000;
      let domain: string | undefined;
      try { domain = new URL(data.website_url).hostname; } catch { /* ignore */ }
      void logUsage({
        org_id:          orgId,
        event_type:      'page_scan',
        browser_minutes: browserMinutes,
        domain,
        scan_run_id:     scanRunId,
        metadata:        { source: 'audit', audit_id },
      });
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
