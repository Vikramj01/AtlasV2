/**
 * Consent Hub — Database CRUD layer.
 *
 * All Consent Hub DB access goes through these functions.
 * Follows the same pattern as planningQueries.ts.
 *
 * Tables:
 *   consent_configs  — per-project consent configuration
 *   consent_records  — per-visitor consent decisions (audit log)
 */

import { supabaseAdmin as supabase } from './supabase';
import type {
  ConsentConfig,
  ConsentRecord,
  ConsentDecisions,
  ConsentMode,
  ConsentRegulation,
  BannerConfig,
  CMPConfig,
  GCMMapping,
  ConsentSource,
  GCMState,
  ConsentCategoryConfig,
  ConsentAnalyticsResponse,
  ConsentCategory,
} from '@/types/consent';

// ── Default GCM mapping ───────────────────────────────────────────────────────

export const DEFAULT_GCM_MAPPING: GCMMapping = {
  analytics:       ['analytics_storage', 'functionality_storage'],
  marketing:       ['ad_storage', 'ad_user_data', 'ad_personalization'],
  personalisation: ['personalization_storage'],
  functional:      ['functionality_storage'],
};

export const DEFAULT_CATEGORIES: ConsentCategoryConfig[] = [
  {
    id: 'functional',
    name: 'Functional',
    description: 'Essential cookies required for the site to work correctly.',
    required: true,
    default_state: 'granted',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Cookies that help us understand how visitors interact with the site.',
    required: false,
    default_state: 'pending',
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Cookies used to deliver personalised ads and measure campaign performance.',
    required: false,
    default_state: 'pending',
  },
  {
    id: 'personalisation',
    name: 'Personalisation',
    description: 'Cookies that remember your preferences to personalise your experience.',
    required: false,
    default_state: 'pending',
  },
];

// ── Consent Config ────────────────────────────────────────────────────────────

export interface CreateConsentConfigInput {
  project_id: string;
  organization_id: string;
  mode?: ConsentMode;
  regulation?: ConsentRegulation;
  categories?: ConsentCategoryConfig[];
  banner_config?: BannerConfig | null;
  cmp_config?: CMPConfig | null;
  gcm_enabled?: boolean;
  gcm_mapping?: GCMMapping;
}

export async function createConsentConfig(input: CreateConsentConfigInput): Promise<ConsentConfig> {
  const { data, error } = await supabase
    .from('consent_configs')
    .insert({
      project_id: input.project_id,
      organization_id: input.organization_id,
      mode: input.mode ?? 'builtin',
      regulation: input.regulation ?? 'gdpr',
      categories: input.categories ?? DEFAULT_CATEGORIES,
      banner_config: input.banner_config ?? null,
      cmp_config: input.cmp_config ?? null,
      gcm_enabled: input.gcm_enabled ?? true,
      gcm_mapping: input.gcm_mapping ?? DEFAULT_GCM_MAPPING,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create consent config: ${error.message}`);
  return data as ConsentConfig;
}

export async function getConsentConfig(projectId: string): Promise<ConsentConfig | null> {
  const { data, error } = await supabase
    .from('consent_configs')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get consent config: ${error.message}`);
  return data as ConsentConfig | null;
}

export async function upsertConsentConfig(input: CreateConsentConfigInput): Promise<ConsentConfig> {
  const { data, error } = await supabase
    .from('consent_configs')
    .upsert(
      {
        project_id: input.project_id,
        organization_id: input.organization_id,
        mode: input.mode ?? 'builtin',
        regulation: input.regulation ?? 'gdpr',
        categories: input.categories ?? DEFAULT_CATEGORIES,
        banner_config: input.banner_config ?? null,
        cmp_config: input.cmp_config ?? null,
        gcm_enabled: input.gcm_enabled ?? true,
        gcm_mapping: input.gcm_mapping ?? DEFAULT_GCM_MAPPING,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' }
    )
    .select('*')
    .single();

  if (error) throw new Error(`Failed to upsert consent config: ${error.message}`);
  return data as ConsentConfig;
}

// ── Consent Records ───────────────────────────────────────────────────────────

export interface CreateConsentRecordInput {
  project_id: string;
  organization_id: string;
  visitor_id: string;
  consent_id: string;
  decisions: ConsentDecisions;
  gcm_state: GCMState | null;
  regulation: string;
  ip_country: string | null;
  user_agent: string | null;
  source: ConsentSource;
  ttl_days: number;
}

export async function createConsentRecord(input: CreateConsentRecordInput): Promise<ConsentRecord> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + input.ttl_days);

  const { data, error } = await supabase
    .from('consent_records')
    .insert({
      project_id: input.project_id,
      organization_id: input.organization_id,
      visitor_id: input.visitor_id,
      consent_id: input.consent_id,
      decisions: input.decisions,
      gcm_state: input.gcm_state,
      regulation: input.regulation,
      ip_country: input.ip_country,
      user_agent: input.user_agent,
      source: input.source,
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create consent record: ${error.message}`);
  return data as ConsentRecord;
}

export async function getLatestConsentRecord(
  projectId: string,
  visitorId: string,
): Promise<ConsentRecord | null> {
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('project_id', projectId)
    .eq('visitor_id', visitorId)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to get consent record: ${error.message}`);
  return data as ConsentRecord | null;
}

export async function deleteConsentRecords(
  projectId: string,
  visitorId: string,
): Promise<number> {
  const { error, count } = await supabase
    .from('consent_records')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .eq('visitor_id', visitorId);

  if (error) throw new Error(`Failed to delete consent records: ${error.message}`);
  return count ?? 0;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function getConsentAnalytics(
  projectId: string,
  organizationId: string,
  period: '7d' | '30d' | '90d' | 'all',
): Promise<ConsentAnalyticsResponse> {
  const since = periodToDate(period);

  let query = supabase
    .from('consent_records')
    .select('decisions, ip_country, created_at')
    .eq('project_id', projectId)
    .eq('organization_id', organizationId);

  if (since) {
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get consent analytics: ${error.message}`);

  const records = (data ?? []) as Array<{
    decisions: ConsentDecisions;
    ip_country: string | null;
    created_at: string;
  }>;

  const categories: ConsentCategory[] = ['analytics', 'marketing', 'personalisation', 'functional'];
  const total = records.length;

  // Opt-in rate per category
  const opt_in_rate = Object.fromEntries(
    categories.map((cat) => {
      const granted = records.filter((r) => r.decisions[cat] === 'granted').length;
      return [cat, total > 0 ? Math.round((granted / total) * 100) : 0];
    }),
  ) as Record<ConsentCategory, number>;

  // By country
  const countryMap = new Map<string, { granted: number; total: number }>();
  for (const r of records) {
    const country = r.ip_country ?? 'unknown';
    const existing = countryMap.get(country) ?? { granted: 0, total: 0 };
    const isGranted = Object.values(r.decisions).some((d) => d === 'granted');
    countryMap.set(country, {
      granted: existing.granted + (isGranted ? 1 : 0),
      total: existing.total + 1,
    });
  }
  const by_country = Array.from(countryMap.entries()).map(([country, { granted, total: t }]) => ({
    country,
    opt_in_rate: t > 0 ? Math.round((granted / t) * 100) : 0,
    total: t,
  }));

  // By day
  const dayMap = new Map<string, { granted: number; denied: number }>();
  for (const r of records) {
    const day = r.created_at.slice(0, 10);
    const existing = dayMap.get(day) ?? { granted: 0, denied: 0 };
    const isGranted = Object.values(r.decisions).some((d) => d === 'granted');
    dayMap.set(day, {
      granted: existing.granted + (isGranted ? 1 : 0),
      denied: existing.denied + (isGranted ? 0 : 1),
    });
  }
  const by_day = Array.from(dayMap.entries())
    .map(([date, { granted, denied }]) => ({ date, granted, denied }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    total_decisions: total,
    opt_in_rate,
    by_country,
    by_day,
    consent_coverage: total > 0 ? 100 : 0, // placeholder: real coverage requires event join
  };
}

function periodToDate(period: '7d' | '30d' | '90d' | 'all'): Date | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
