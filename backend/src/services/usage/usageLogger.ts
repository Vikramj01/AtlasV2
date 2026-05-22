/**
 * Usage Logger — fire-and-forget logging of Browserbase and Claude API costs.
 *
 * Design contract:
 *  - logUsage() NEVER throws and NEVER blocks the calling operation.
 *  - cost_usd is computed at write time; update the constants below whenever
 *    Browserbase or Anthropic invoices arrive with revised per-unit rates.
 *  - The service role client bypasses RLS (usage_events allows service_role only).
 */
import { supabaseAdmin } from '@/services/database/supabase';

export type UsageEventType =
  | 'page_scan'
  | 'ai_report_scheduled'
  | 'ai_report_ondemand'
  | 'ai_query_ondemand'
  | 'dma_ingest_event'
  | 'dma_enricher_event';

export interface UsageEventPayload {
  org_id: string;
  event_type: UsageEventType;
  // Browserbase (page_scan)
  browser_minutes?: number;
  pages_scanned?: number;
  domain?: string;
  // Claude (ai_*)
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
  // DMA (dma_ingest_event / dma_enricher_event)
  dma_member_count?: number;
  dma_matched_count?: number;
  // Pre-computed cost (if not provided, computed from other fields)
  cost_usd?: number;
  // Traceability
  job_id?: string;
  scan_run_id?: string;
  metadata?: Record<string, unknown>;
}

// ── Pricing constants ─────────────────────────────────────────────────────────
// Browserbase: $0.12 per browser hour (overage rate from Developer plan).
// Confirmed from Browserbase pricing screenshot — update when plan changes.
const BROWSERBASE_COST_PER_MINUTE = 0.12 / 60; // $0.002/min

// DMA pricing: $0.002 per 1,000 members ingested (internal estimate; update from Google invoice)
const DMA_COST_PER_MEMBER = 0.002 / 1000;

// Claude token pricing (per token). Update from Anthropic invoice when rates change.
const CLAUDE_PRICING: Record<string, { input: number; output: number }> = {
  // Sonnet 4.6 — $3.00/1M input, $15.00/1M output
  'claude-sonnet-4-6': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  // Haiku 4.5 — $1.00/1M input, $5.00/1M output (estimate; update from invoice)
  'claude-haiku-4-5-20251001': { input: 1.0 / 1_000_000, output: 5.0 / 1_000_000 },
};
// Default fallback (Sonnet rates)
const CLAUDE_DEFAULT_PRICING = { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 };

// ── Public API ────────────────────────────────────────────────────────────────

export async function logUsage(payload: UsageEventPayload): Promise<void> {
  try {
    const cost_usd = payload.cost_usd ?? computeCost(payload);

    const { error } = await supabaseAdmin.from('usage_events').insert({
      org_id:          payload.org_id,
      event_type:      payload.event_type,
      browser_minutes: payload.browser_minutes ?? null,
      pages_scanned:   payload.pages_scanned   ?? null,
      domain:          payload.domain          ?? null,
      input_tokens:    payload.input_tokens    ?? null,
      output_tokens:   payload.output_tokens   ?? null,
      model:           payload.model           ?? null,
      cost_usd,
      job_id:          payload.job_id          ?? null,
      scan_run_id:     payload.scan_run_id     ?? null,
      metadata:        payload.metadata        ?? null,
    });

    if (error) {
      console.error('[usageLogger] Failed to insert usage event:', error.message);
    }
  } catch (err) {
    // Never propagate — a logging failure must not crash a customer-facing operation
    console.error('[usageLogger] Unexpected error:', err instanceof Error ? err.message : String(err));
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeCost(payload: UsageEventPayload): number {
  if (payload.event_type === 'page_scan') {
    return (payload.browser_minutes ?? 0) * BROWSERBASE_COST_PER_MINUTE;
  }

  if (payload.event_type.startsWith('ai_')) {
    const rates = (payload.model && CLAUDE_PRICING[payload.model])
      ? CLAUDE_PRICING[payload.model]
      : CLAUDE_DEFAULT_PRICING;
    return (
      (payload.input_tokens  ?? 0) * rates.input +
      (payload.output_tokens ?? 0) * rates.output
    );
  }

  if (payload.event_type === 'dma_ingest_event' || payload.event_type === 'dma_enricher_event') {
    return (payload.dma_member_count ?? 0) * DMA_COST_PER_MEMBER;
  }

  return 0;
}
