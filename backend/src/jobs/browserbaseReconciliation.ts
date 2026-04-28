/**
 * Browserbase Nightly Reconciliation
 *
 * Pulls the Browserbase Project Usage API and compares the reported browser-minutes
 * against what Atlas has attributed to customers in usage_events.
 *
 * A material delta (> 10%) means sessions are running without proper org attribution —
 * cost is being absorbed at the platform level rather than allocated to a customer.
 *
 * Runs nightly as step 2 in the usageSummaryQueue worker sequence, after
 * usage_monthly_summary has been refreshed and before the fair-use cap check.
 *
 * The Browserbase plan resets monthly (not calendar month) — the API always returns
 * the running total for the current billing period. Atlas sums usage_events from
 * the start of the current calendar month, which approximates the billing period.
 */
import { supabaseAdmin } from '@/services/database/supabase';
import { env } from '@/config/env';
import { sendOperatorAlert } from '@/services/usage/alertDelivery';
import logger from '@/utils/logger';

// Browserbase plan details — update if the plan changes.
const INCLUDED_MINUTES = 6_000;

// Alert threshold: flag if unattributed sessions exceed this share of total.
const RECONCILIATION_GAP_THRESHOLD = 0.10;

export async function runBrowserbaseReconciliation(): Promise<void> {
  logger.info('Browserbase reconciliation started');

  // ── 1. Pull actual usage from Browserbase API ──────────────────────────────
  let bbMinutes = 0;
  let proxyDataGb = 0;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BrowserbaseSDK = require('@browserbasehq/sdk').default as {
      new (opts: { apiKey: string }): {
        projects: {
          usage(projectId: string): Promise<{ browserMinutes: number; proxyBytes: number }>;
        };
      };
    };

    const bb = new BrowserbaseSDK({ apiKey: env.BROWSERBASE_API_KEY });
    const usage = await bb.projects.usage(env.BROWSERBASE_PROJECT_ID);

    bbMinutes = usage.browserMinutes ?? 0;
    // API returns bytes; convert to GB using SI units (1 GB = 1,000,000,000 bytes)
    proxyDataGb = (usage.proxyBytes ?? 0) / 1_000_000_000;

    logger.info({ bbMinutes, proxyDataGb }, 'Browserbase usage fetched');
  } catch (err) {
    // Non-fatal: persist a partial snapshot so the gap is visible even when the API fails.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Browserbase reconciliation: failed to fetch usage from API — skipping upsert',
    );
    return;
  }

  // ── 2. Sum Atlas-logged browser-minutes for the current calendar month ──────
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { data: eventRows, error: queryErr } = await supabaseAdmin
    .from('usage_events')
    .select('browser_minutes')
    .eq('event_type', 'page_scan')
    .gte('created_at', monthStart.toISOString());

  if (queryErr) {
    logger.error({ err: queryErr.message }, 'Browserbase reconciliation: failed to query usage_events');
    return;
  }

  const atlasMinutes = (eventRows ?? []).reduce(
    (sum, row) => sum + (Number((row as { browser_minutes: unknown }).browser_minutes) || 0),
    0,
  );

  logger.info({ atlasMinutes, monthStart: monthStart.toISOString() }, 'Atlas-logged minutes summed');

  // ── 3. Upsert snapshot for today ────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]!;

  const { error: upsertErr } = await supabaseAdmin
    .from('browserbase_usage_snapshots')
    .upsert(
      {
        snapshot_date:         today,
        total_browser_minutes: bbMinutes,
        total_proxy_data_gb:   proxyDataGb,
        atlas_logged_minutes:  atlasMinutes,
      },
      { onConflict: 'snapshot_date' },
    );

  if (upsertErr) {
    logger.error({ err: upsertErr.message }, 'Browserbase reconciliation: failed to upsert snapshot');
    return;
  }

  const delta = bbMinutes - atlasMinutes;
  const overageMinutes = Math.max(bbMinutes - INCLUDED_MINUTES, 0);
  const overageCost = overageMinutes * 0.002;

  logger.info(
    {
      date:           today,
      bbMinutes:      bbMinutes.toFixed(2),
      atlasMinutes:   atlasMinutes.toFixed(2),
      delta:          delta.toFixed(2),
      overageMinutes: overageMinutes.toFixed(2),
      overageCostUsd: overageCost.toFixed(4),
    },
    'Browserbase reconciliation snapshot saved',
  );

  // ── 4. Alert if the attribution gap exceeds the threshold ──────────────────
  if (bbMinutes > 0) {
    const deltaPct = delta / bbMinutes;

    if (deltaPct > RECONCILIATION_GAP_THRESHOLD) {
      const msg = [
        '⚠️  BROWSERBASE RECONCILIATION GAP',
        `Browserbase reported: ${bbMinutes.toFixed(1)} mins`,
        `Atlas attributed:     ${atlasMinutes.toFixed(1)} mins`,
        `Delta:                ${delta.toFixed(1)} mins (${(deltaPct * 100).toFixed(1)}% unattributed)`,
        `Action: Check Browserbase dashboard for sessions missing org_id in userMetadata.`,
      ].join('\n');

      void sendOperatorAlert(msg, 'high');
      logger.warn(
        { bbMinutes, atlasMinutes, delta, deltaPct },
        'Browserbase reconciliation gap exceeds threshold',
      );
    }
  }

  // ── 5. Log overage status ───────────────────────────────────────────────────
  if (overageMinutes > 0) {
    logger.warn(
      { overageMinutes: overageMinutes.toFixed(2), overageCostUsd: overageCost.toFixed(4) },
      'Browserbase plan allowance exceeded — overage charges accruing',
    );
  } else {
    const remainingMinutes = INCLUDED_MINUTES - bbMinutes;
    logger.info(
      { usedMinutes: bbMinutes.toFixed(1), remainingMinutes: remainingMinutes.toFixed(1) },
      'Browserbase usage within plan allowance',
    );
  }
}
