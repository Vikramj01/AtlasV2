/**
 * EnrichmentConfigService
 *
 * Resolves dataLayer field paths from raw event data and applies
 * identity + signal enrichment config to AtlasEvents before they
 * reach the CAPI provider adapters.
 */

import type { AtlasEvent, IdentifierType } from '@/types/capi';
import type {
  ClientIdentityConfig,
  SignalEnrichmentConfig,
  EnrichmentValidationResult,
  EnrichmentWarning,
  ClientEnrichmentScore,
} from '@/types/enrichment';

// ─── Field Path Resolution ────────────────────────────────────────────────────

/**
 * Resolves a dotted path like 'ecommerce.purchase.actionField.id'
 * against a raw event data object. Returns undefined if any segment is missing.
 */
export function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path || path === 'auto') return undefined;
  return path.split('.').reduce((acc: unknown, key: string) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj as unknown);
}

/**
 * Validates that a field path string contains only safe characters.
 * Allows dots, brackets, alphanumerics and underscores.
 */
export function validateFieldPathSyntax(path: string): boolean {
  return /^[a-zA-Z0-9_.[\]]+$/.test(path);
}

// ─── Identity Enrichment ──────────────────────────────────────────────────────

/**
 * Applies client identity config to an AtlasEvent, resolving identity
 * fields from the raw event data object. PII hashing is handled downstream
 * by the CAPI pipeline's hash step.
 */
export function applyIdentityConfig(
  event: AtlasEvent,
  rawEventData: Record<string, unknown>,
  identityConfig: ClientIdentityConfig,
  requestIp?: string,
  requestUa?: string,
): AtlasEvent {
  const enabled = new Set<IdentifierType>(identityConfig.enabled_identifiers);
  const ud = { ...(event.user_data ?? {}) };

  const resolve = (field: string | null | undefined) =>
    field ? resolveFieldPath(rawEventData, field) : undefined;

  if (enabled.has('email') && identityConfig.email_field) {
    const v = resolve(identityConfig.email_field);
    if (typeof v === 'string' && v) ud.email = v;
  }
  if (enabled.has('phone') && identityConfig.phone_field) {
    const v = resolve(identityConfig.phone_field);
    if (typeof v === 'string' && v) ud.phone = v;
  }
  if (enabled.has('fn') && identityConfig.first_name_field) {
    const v = resolve(identityConfig.first_name_field);
    if (typeof v === 'string' && v) ud.first_name = v;
  }
  if (enabled.has('ln') && identityConfig.last_name_field) {
    const v = resolve(identityConfig.last_name_field);
    if (typeof v === 'string' && v) ud.last_name = v;
  }
  if (enabled.has('zp') && identityConfig.postal_code_field) {
    const v = resolve(identityConfig.postal_code_field);
    if (typeof v === 'string' && v) ud.zip = v;
  }
  if (enabled.has('country') && identityConfig.country_field) {
    const v = resolve(identityConfig.country_field);
    if (typeof v === 'string' && v) ud.country = v;
  }
  if (enabled.has('external_id') && identityConfig.external_id_field) {
    const v = resolve(identityConfig.external_id_field);
    if (v !== undefined && v !== null) ud.external_id = String(v);
  }

  // Click IDs — read from raw data or flat cookie store
  if (enabled.has('fbc')) {
    const v = resolve(identityConfig.fbc_field) ?? rawEventData[identityConfig.fbc_field];
    if (typeof v === 'string' && v) ud.fbc = v;
  }
  if (enabled.has('fbp')) {
    const v = resolve(identityConfig.fbp_field) ?? rawEventData[identityConfig.fbp_field];
    if (typeof v === 'string' && v) ud.fbp = v;
  }
  if (enabled.has('gclid')) {
    const v = resolve(identityConfig.gclid_field) ?? rawEventData[identityConfig.gclid_field];
    if (typeof v === 'string' && v) ud.gclid = v;
  }
  if (enabled.has('wbraid')) {
    const v = resolve(identityConfig.wbraid_field) ?? rawEventData[identityConfig.wbraid_field];
    if (typeof v === 'string' && v) ud.wbraid = v;
  }
  if (enabled.has('gbraid')) {
    const v = resolve(identityConfig.gbraid_field) ?? rawEventData[identityConfig.gbraid_field];
    if (typeof v === 'string' && v) ud.gbraid = v;
  }

  // Auto-capture from request context
  if (identityConfig.auto_capture_ip && requestIp) ud.client_ip_address = requestIp;
  if (identityConfig.auto_capture_ua && requestUa) ud.client_user_agent = requestUa;

  return { ...event, user_data: ud };
}

// ─── Signal Enrichment ────────────────────────────────────────────────────────

/**
 * Applies signal-level enrichment config to an AtlasEvent's custom_data,
 * resolving value, currency, dedup ID, and content IDs from raw event data.
 */
export function applySignalEnrichment(
  event: AtlasEvent,
  rawEventData: Record<string, unknown>,
  enrichmentConfig: SignalEnrichmentConfig,
): AtlasEvent {
  const cd = { ...(event.custom_data ?? {}) };

  // Value
  if (enrichmentConfig.value_config?.field) {
    let value = resolveFieldPath(rawEventData, enrichmentConfig.value_config.field);
    if (typeof value === 'string') value = parseFloat(value);
    if (typeof value === 'number' && !isNaN(value)) cd.value = value;
  }

  // Currency
  if (enrichmentConfig.currency_config) {
    const cc = enrichmentConfig.currency_config;
    if (cc.mode === 'static' && cc.static_value) {
      cd.currency = cc.static_value;
    } else if (cc.mode === 'dynamic' && cc.field) {
      const v = resolveFieldPath(rawEventData, cc.field);
      if (typeof v === 'string' && v) cd.currency = v;
    }
  }

  // Dedup / order ID
  if (enrichmentConfig.dedup_config?.field) {
    const v = resolveFieldPath(rawEventData, enrichmentConfig.dedup_config.field);
    if (v !== undefined && v !== null) cd.order_id = String(v);
  }

  // Content IDs
  if (enrichmentConfig.content_config?.ids_field) {
    const ids = resolveFieldPath(rawEventData, enrichmentConfig.content_config.ids_field);
    if (Array.isArray(ids)) {
      cd.content_ids = ids.map(String);
      cd.num_items = ids.length;
    }
  }

  // Propagate event_source onto the event so both Meta and Google adapters
  // receive the correct action_source / DMA EventSource without extra lookups.
  const eventSource = enrichmentConfig.event_source ?? 'website';
  return { ...event, action_source: eventSource, custom_data: cd };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates a signal enrichment config and returns a score + warnings.
 * Called on save and on explicit validate requests.
 */
export function validateSignalEnrichment(
  config: SignalEnrichmentConfig,
): EnrichmentValidationResult {
  const warnings: EnrichmentWarning[] = [];
  const requiredMissing: string[] = [];
  const recommendedMissing: string[] = [];

  if (!config.value_config?.field) {
    requiredMissing.push('value_field');
    warnings.push({
      field: 'value_field',
      message: 'Order/conversion value field is required for value-based bidding',
      severity: 'error',
    });
  }

  if (!config.dedup_config?.field) {
    requiredMissing.push('dedup_id_field');
    warnings.push({
      field: 'dedup_id_field',
      message: 'Deduplication ID field is required to prevent double-counting browser and server events',
      severity: 'error',
    });
  }

  if (!config.currency_config) {
    requiredMissing.push('currency');
    warnings.push({
      field: 'currency',
      message: 'Currency must be configured (static or dynamic)',
      severity: 'error',
    });
  }

  if (!config.content_config?.ids_field) {
    recommendedMissing.push('content_ids_field');
    warnings.push({
      field: 'content_ids_field',
      message: 'Product ID array field missing — dynamic product retargeting will not work',
      severity: 'warning',
    });
  }

  if (config.value_config?.includes_tax) {
    warnings.push({
      field: 'value_field',
      message: 'Value includes tax — this may inflate reported ROAS',
      severity: 'info',
    });
  }

  if (config.value_config?.includes_shipping) {
    warnings.push({
      field: 'value_field',
      message: 'Value includes shipping — this may inflate reported ROAS',
      severity: 'info',
    });
  }

  let score = 100;
  score -= requiredMissing.length * 25;
  score -= recommendedMissing.length * 10;
  score = Math.max(0, score);

  return { score, warnings, required_missing: requiredMissing, recommended_missing: recommendedMissing };
}

// ─── Client Enrichment Score ──────────────────────────────────────────────────

/**
 * Computes an overall enrichment score for a client dashboard display.
 * Combines identity config completeness with signal-level scores.
 */
export function computeClientEnrichmentScore(
  identityConfig: ClientIdentityConfig | null,
  signalEnrichments: SignalEnrichmentConfig[],
): ClientEnrichmentScore {
  let identityScore = 0;

  if (identityConfig) {
    const enabled = new Set(identityConfig.enabled_identifiers);
    if (enabled.has('email') && identityConfig.email_field) identityScore += 35;
    if (enabled.has('phone') && identityConfig.phone_field) identityScore += 20;
    if (enabled.has('fbc') && identityConfig.fbc_field) identityScore += 15;
    if (enabled.has('fbp') && identityConfig.fbp_field) identityScore += 10;
    if (enabled.has('gclid') && identityConfig.gclid_field) identityScore += 10;
    if (identityConfig.auto_capture_ip) identityScore += 5;
    if (identityConfig.auto_capture_ua) identityScore += 5;
  }

  const signalScores = signalEnrichments.map(e => ({
    signal_key: e.signal_key,
    signal_name: e.signal_key,
    score: e.validation_score ?? 0,
    warnings: e.validation_warnings,
  }));

  const avgSignalScore =
    signalScores.length > 0
      ? signalScores.reduce((acc, s) => acc + s.score, 0) / signalScores.length
      : 0;

  const overall = Math.round(identityScore * 0.5 + avgSignalScore * 0.5);

  const estimatedMetaEmq =
    identityScore >= 80 ? 8 : identityScore >= 60 ? 6 : identityScore >= 40 ? 4 : 2;

  const estimatedGoogleMatchRate =
    identityScore >= 70 ? 65 : identityScore >= 50 ? 45 : 20;

  return {
    overall,
    identity_score: identityScore,
    signal_scores: signalScores,
    estimated_meta_emq: estimatedMetaEmq,
    estimated_google_match_rate: estimatedGoogleMatchRate,
  };
}
