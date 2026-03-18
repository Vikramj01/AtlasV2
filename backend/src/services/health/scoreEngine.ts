/**
 * Health Score Engine
 *
 * Queries existing tables to compute health metrics for a user:
 *   1. signal_health   — from most recent completed audit
 *   2. capi_delivery   — from capi_providers delivery counters
 *   3. consent         — binary: configured = 100, missing = 0
 *   4. tag_firing_rate — mirrors signal_health (both come from audit)
 *
 * Overall score formula (weighted):
 *   40% signal_health + 30% capi_delivery + 20% consent + 10% freshness
 */

import { supabaseAdmin } from '@/services/database/supabase';
import type { ComputedMetrics } from '@/types/health';
import type { ReportJSON } from '@/types/audit';

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchLatestAuditScore(userId: string): Promise<{
  signal_health: number;
  last_audit_id: string | null;
  last_audit_at: string | null;
  days_since_audit: number | null;
}> {
  const { data } = await supabaseAdmin
    .from('audits')
    .select('id, created_at, audit_reports(report_json)')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) {
    return { signal_health: 0, last_audit_id: null, last_audit_at: null, days_since_audit: null };
  }

  const reportRows = row['audit_reports'] as Array<{ report_json: ReportJSON }> | null;
  const score = reportRows?.[0]?.report_json?.executive_summary?.scores?.conversion_signal_health ?? 0;
  const daysSince = Math.floor(
    (Date.now() - new Date(row.created_at as string).getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    signal_health: Math.round(score),
    last_audit_id: row.id as string,
    last_audit_at: row.created_at as string,
    days_since_audit: daysSince,
  };
}

async function fetchCAPIDeliveryRate(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('capi_providers')
    .select('status, delivery_count, failed_count')
    .eq('organization_id', userId)
    .eq('status', 'active');

  if (!data || data.length === 0) return -1; // -1 = no CAPI configured

  type ProviderRow = { delivery_count: number; failed_count: number };
  const totalDelivered = (data as ProviderRow[]).reduce((sum, p) => sum + (p.delivery_count ?? 0), 0);
  const totalFailed    = (data as ProviderRow[]).reduce((sum, p) => sum + (p.failed_count ?? 0), 0);
  const total = totalDelivered + totalFailed;

  if (total === 0) return 100; // no events yet, treat as healthy
  return Math.round((totalDelivered / total) * 100 * 100) / 100;
}

async function fetchConsentCoverage(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('consent_configs')
    .select('id')
    .eq('organization_id', userId)
    .limit(1);

  return (data?.length ?? 0) > 0 ? 100 : 0;
}

// ── Freshness score (0–100) ────────────────────────────────────────────────────
// 100 = audit in last 7 days, 50 = 7–30 days, 0 = >30 days or no audit

function freshnessScore(daysSinceAudit: number | null): number {
  if (daysSinceAudit === null) return 0;
  if (daysSinceAudit <= 7) return 100;
  if (daysSinceAudit <= 30) return 50;
  return 0;
}

// ── Overall score formula ─────────────────────────────────────────────────────

function computeOverallScore(
  signalHealth: number,
  capiDelivery: number,
  consent: number,
  daysSince: number | null,
): number {
  const capiContribution = capiDelivery === -1
    ? 70  // no CAPI = neutral (not penalised heavily, just not full marks)
    : capiDelivery;

  const score =
    signalHealth    * 0.40 +
    capiContribution * 0.30 +
    consent          * 0.20 +
    freshnessScore(daysSince) * 0.10;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function computeHealthMetrics(userId: string): Promise<{
  metrics: ComputedMetrics;
  overallScore: number;
}> {
  const [auditData, capiRate, consent] = await Promise.all([
    fetchLatestAuditScore(userId),
    fetchCAPIDeliveryRate(userId),
    fetchConsentCoverage(userId),
  ]);

  const metrics: ComputedMetrics = {
    signal_health:       auditData.signal_health,
    capi_delivery_rate:  capiRate === -1 ? 0 : capiRate,
    consent_coverage:    consent,
    tag_firing_rate:     auditData.signal_health, // derived from same audit
    last_audit_id:       auditData.last_audit_id,
    last_audit_at:       auditData.last_audit_at,
  };

  const overallScore = computeOverallScore(
    auditData.signal_health,
    capiRate,
    consent,
    auditData.days_since_audit,
  );

  return { metrics, overallScore };
}
