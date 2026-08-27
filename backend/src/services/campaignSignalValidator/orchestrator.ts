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
    const verdict = evaluateEventVerdict({ siteDetection, primaryStage });

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
