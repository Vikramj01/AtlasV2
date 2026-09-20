/**
 * Campaign Signal Validator — Diagnostic Orchestrator
 *
 * Reuses the same building blocks as Planning Mode's zero-cost site scan
 * (siteDetectionService.detectSite) and, when a client is linked, the most
 * recent Journey Builder stage data (proxy_value_gbp / buyer_intent_level)
 * to run the event-verdict heuristic and persist a signal_validator_runs row.
 *
 * Deliberately does not use Browserbase/pageCaptureService in v1 — the
 * lightweight fetch+parse scan is enough signal for the heuristics in
 * eventVerdict.ts, and skipping browser automation keeps both the in-app and
 * (unauthenticated, paid) standalone flow fast and cheap to run per request.
 */

import { detectSite } from '@/services/planning/siteDetectionService';
import { evaluateEventVerdict, type PrimaryStageInput, type EventVerdict } from './eventVerdict';
import { supabaseAdmin } from '@/services/database/supabase';
import { createBrowserbaseSession, getCDPUrl } from '@/services/browserbase/client';
import { simulateJourney } from '@/services/audit/journeySimulator';
import { deriveAttributionChain } from '@/services/attribution/chainOrchestration';
import type { AttributionChainResult } from '@/services/attribution/chainModel';
import logger from '@/utils/logger';

export interface DiagnosticRunResult {
  id: string;
  status: 'completed' | 'failed';
  verdict: EventVerdict | null;
  error_message: string | null;
}

/**
 * Create a run row, execute the diagnostic, and persist the result.
 * Never throws — a failed scan is recorded as a 'failed' run, not an
 * exception, so callers (routes, the Stripe webhook) can handle it uniformly.
 */
export async function runDiagnostic(params: {
  url: string;
  source: 'in_app' | 'standalone';
  organizationId?: string | null;
  clientId?: string | null;
}): Promise<DiagnosticRunResult> {
  const { url, source, organizationId = null, clientId = null } = params;

  const { data: runRow, error: insertError } = await supabaseAdmin
    .from('signal_validator_runs')
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      source,
      url,
      status: 'running',
    })
    .select('id')
    .single();

  if (insertError || !runRow) {
    logger.error({ err: insertError, url }, '[campaignSignalValidator] Failed to create run row');
    throw new Error('Failed to create diagnostic run');
  }

  const runId = (runRow as { id: string }).id;

  try {
    const siteDetection = await detectSite(url);
    const primaryStage = clientId ? await loadPrimaryStage(clientId) : null;

    // Attribution Chain Check PRD §8 — lead-gen only, since Links 1-3 are
    // meaningless without a lead-gen form to submit. Unlike the rest of
    // this diagnostic (a zero-cost fetch+parse scan, deliberately kept
    // cheap per this file's own header), this branch runs a real
    // Browserbase session — the chain's raw inputs (synthetic click-id
    // persistence, an actual form submit's captured network request) don't
    // exist without one. Justified per-call cost here: the standalone
    // flow only ever reaches this after a completed Stripe purchase
    // (checkoutService.fulfilSignalValidatorPurchase), and the in-app flow
    // is authenticated/org-scoped, the same trust level Atlas's full Audit
    // Engine already extends to a logged-in user's own Browserbase spend.
    // Never fails the whole diagnostic — a scan failure here just leaves
    // attributionChain undefined, so the existing zero-cost verdict still
    // returns.
    const attributionChain = siteDetection.inferred_business_type === 'lead_gen'
      ? await runLeadGenAttributionScan(runId, url).catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err), runId, url }, '[campaignSignalValidator] Attribution chain scan failed — continuing without it');
        return null;
      })
      : null;

    const verdict = evaluateEventVerdict({ siteDetection, primaryStage, attributionChain });

    await supabaseAdmin
      .from('signal_validator_runs')
      .update({
        status: 'completed',
        site_detection: siteDetection,
        verdict,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    return { id: runId, status: 'completed', verdict, error_message: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, url, runId }, '[campaignSignalValidator] Diagnostic run failed');

    await supabaseAdmin
      .from('signal_validator_runs')
      .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
      .eq('id', runId);

    return { id: runId, status: 'failed', verdict: null, error_message: message };
  }
}

// Identifiable, obviously-synthetic address — per PRD §5.2, a test
// submission may genuinely reach the prospect's real CRM (the existing
// journeySimulator.ts form-fill behavior this reuses already has this
// property and it's accepted). Keeping it stable and Atlas-branded lets a
// prospect's team recognise and discard the resulting lead record.
const ATTRIBUTION_SCAN_TEST_EMAIL = 'atlas-signal-validator-scan@example.com';

/**
 * Runs a real, lead-gen-only Browserbase scan solely to produce the
 * pre-connection attribution chain (Links 1-3) — see Attribution Chain
 * Check PRD §5/§8. Deliberately narrow: only injects synthetic click IDs,
 * fills/submits the landing page's lead-gen form, and returns the derived
 * chain, rather than running the full Check Register v2 report this
 * product has no other use for.
 */
async function runLeadGenAttributionScan(runId: string, url: string): Promise<AttributionChainResult | null> {
  const session = await createBrowserbaseSession({ product: 'campaign_signal_validator', run_id: runId });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as {
    chromium: { connectOverCDP: (url: string) => Promise<unknown> };
  };
  const browser = await chromium.connectOverCDP(getCDPUrl(session.id)) as Parameters<typeof simulateJourney>[0];

  // Not explicitly closed — same convention as the full Audit Engine's own
  // orchestrator.ts, where simulateJourney's own context.close() is the
  // only cleanup and the CDP connection itself is left to the Browserbase
  // session's own lifecycle (this file never introduced a different
  // pattern for that elsewhere in this codebase).
  const auditData = await simulateJourney(browser, {
    audit_id: runId,
    website_url: url,
    funnel_type: 'lead_gen',
    region: 'us',
    url_map: {},
    test_email: ATTRIBUTION_SCAN_TEST_EMAIL,
    rule_set_version: 'v2',
  });

  return deriveAttributionChain(auditData, 'pre_connection');
}

export async function getRun(runId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from('signal_validator_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  return data ?? null;
}

export async function listRunsForOrg(
  organizationId: string,
  clientId?: string | null,
): Promise<Record<string, unknown>[]> {
  let query = supabaseAdmin
    .from('signal_validator_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (clientId) query = query.eq('client_id', clientId);

  const { data } = await query;
  return data ?? [];
}

// ── Journey Builder integration ─────────────────────────────────────────────

/**
 * Loads the primary (final) conversion stage from the client's most recent
 * journey — the highest stage_order row — to feed proxy_value_gbp and
 * buyer_intent_level into the verdict heuristic. Returns null if the client
 * has no linked journey yet (verdict logic degrades gracefully in that case).
 */
async function loadPrimaryStage(clientId: string): Promise<PrimaryStageInput | null> {
  const { data: journey } = await supabaseAdmin
    .from('journeys')
    .select('id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!journey) return null;

  const { data: stage } = await supabaseAdmin
    .from('journey_stages')
    .select('label, proxy_value_gbp, buyer_intent_level')
    .eq('journey_id', (journey as { id: string }).id)
    .order('stage_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!stage) return null;

  const row = stage as { label: string; proxy_value_gbp: number | null; buyer_intent_level: string | null };
  return {
    label: row.label,
    proxy_value_gbp: row.proxy_value_gbp,
    buyer_intent_level: row.buyer_intent_level,
  };
}
