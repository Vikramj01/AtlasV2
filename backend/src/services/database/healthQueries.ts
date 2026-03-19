/**
 * Health Dashboard — Database CRUD layer.
 *
 * Tables: health_scores, health_snapshots, health_alerts
 */

import { supabaseAdmin } from './supabase';
import type {
  HealthScore,
  HealthSnapshot,
  HealthAlert,
  AlertType,
  AlertSeverity,
  ComputedMetrics,
  SiteOption,
} from '@/types/health';

// ── health_scores ─────────────────────────────────────────────────────────────

/**
 * Upsert the latest health score for a user (one row per user).
 */
export async function upsertHealthScore(
  userId: string,
  metrics: ComputedMetrics,
  overallScore: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('health_scores')
    .upsert(
      {
        user_id: userId,
        website_url: metrics.website_url ?? null,
        overall_score: overallScore,
        signal_health: metrics.signal_health,
        capi_delivery_rate: metrics.capi_delivery_rate,
        consent_coverage: metrics.consent_coverage,
        tag_firing_rate: metrics.tag_firing_rate,
        last_audit_id: metrics.last_audit_id,
        last_audit_at: metrics.last_audit_at,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) throw error;
}

export async function getHealthScore(userId: string): Promise<HealthScore | null> {
  const { data, error } = await supabaseAdmin
    .from('health_scores')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data as HealthScore;
}

/**
 * Returns distinct sites (website_url) from the user's completed audits,
 * ordered by most recent audit date.
 */
export async function getDistinctSites(userId: string): Promise<SiteOption[]> {
  const { data, error } = await supabaseAdmin
    .from('audits')
    .select('website_url, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  // Deduplicate by website_url, keeping the most recent created_at
  const seen = new Map<string, string>();
  for (const row of data as Array<{ website_url: string; created_at: string }>) {
    if (row.website_url && !seen.has(row.website_url)) {
      seen.set(row.website_url, row.created_at);
    }
  }

  return Array.from(seen.entries()).map(([website_url, last_audit_at]) => ({
    website_url,
    last_audit_at,
  }));
}

// ── health_snapshots ──────────────────────────────────────────────────────────

export async function insertSnapshot(
  userId: string,
  metrics: ComputedMetrics,
  overallScore: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('health_snapshots')
    .insert({
      user_id: userId,
      website_url: metrics.website_url ?? null,
      overall_score: overallScore,
      signal_health: metrics.signal_health,
      capi_delivery_rate: metrics.capi_delivery_rate,
      consent_coverage: metrics.consent_coverage,
      tag_firing_rate: metrics.tag_firing_rate,
      snapshot_at: new Date().toISOString(),
    });

  if (error) throw error;
}

export async function getSnapshots(
  userId: string,
  days = 30,
  websiteUrl?: string,
): Promise<HealthSnapshot[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from('health_snapshots')
    .select('*')
    .eq('user_id', userId)
    .gte('snapshot_at', since)
    .order('snapshot_at', { ascending: true });

  if (websiteUrl) {
    query = query.eq('website_url', websiteUrl);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HealthSnapshot[];
}

// ── health_alerts ─────────────────────────────────────────────────────────────

export async function getActiveAlerts(userId: string): Promise<HealthAlert[]> {
  const { data, error } = await supabaseAdmin
    .from('health_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('triggered_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as HealthAlert[];
}

export async function getAlertByType(
  userId: string,
  alertType: AlertType,
): Promise<HealthAlert | null> {
  const { data } = await supabaseAdmin
    .from('health_alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('alert_type', alertType)
    .eq('is_active', true)
    .single();

  return data ? (data as HealthAlert) : null;
}

export async function createAlert(
  userId: string,
  alertType: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
  metricValue: number | null,
  thresholdValue: number | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('health_alerts')
    .insert({
      user_id: userId,
      alert_type: alertType,
      severity,
      title,
      message,
      metric_value: metricValue,
      threshold_value: thresholdValue,
      is_active: true,
      consecutive_ok_count: 0,
      triggered_at: new Date().toISOString(),
    });

  if (error) throw error;
}

export async function incrementAlertOk(alertId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('health_alerts')
    .select('consecutive_ok_count')
    .eq('id', alertId)
    .single();

  const newCount = ((data as { consecutive_ok_count: number } | null)?.consecutive_ok_count ?? 0) + 1;

  await supabaseAdmin
    .from('health_alerts')
    .update({ consecutive_ok_count: newCount })
    .eq('id', alertId);

  return newCount;
}

export async function resolveAlert(alertId: string): Promise<void> {
  await supabaseAdmin
    .from('health_alerts')
    .update({
      is_active: false,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', alertId);
}

export async function acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('health_alerts')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', userId)
    .eq('is_active', true);

  return !error;
}
