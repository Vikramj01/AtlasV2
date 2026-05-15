export type FindingCode =
  // Delivery (Phase 3)
  | 'CONNECTION_EXPIRED'
  | 'EVENT_NOT_RECEIVED'
  | 'CAPI_DEDUP_LOW'
  | 'EMQ_LOW'
  // Config (Phase 2)
  | 'ATTRIBUTION_MODEL_MISMATCH'
  | 'COUNTING_TYPE_MISMATCH'
  | 'LOOKBACK_WINDOW_SHORT'
  | 'AEM_PRIORITY_TOO_LOW'
  | 'VALUE_SETTINGS_MISSING'
  // Alignment (Phase 2)
  | 'WRONG_PRIMARY_CONVERSION'
  | 'MISSING_PRIMARY_CONVERSION'
  | 'SUPPRESSION_USED_AS_PRIMARY'
  // Volume (Phase 3)
  | 'VOLUME_DELTA_EXCEEDED'
  | 'GA4_VOLUME_DIVERGENCE';

export type FindingDimension = 'delivery' | 'config' | 'alignment' | 'volume';
export type FindingSeverity = 'info' | 'warning' | 'error' | 'critical';

interface FindingMeta {
  dimension: FindingDimension;
  severity: FindingSeverity;
  narrative: (ctx: Record<string, string>) => string;
  remediation: (ctx: Record<string, string>) => string;
}

export const FINDING_META: Record<FindingCode, FindingMeta> = {
  CONNECTION_EXPIRED: {
    dimension: 'delivery',
    severity: 'critical',
    narrative: (ctx) => `The OAuth token for ${ctx.platform} connection "${ctx.account_label}" has expired and cannot be refreshed.`,
    remediation: () => 'Re-authorise the connection from the Platform Connections page.',
  },
  EVENT_NOT_RECEIVED: {
    dimension: 'delivery',
    severity: 'error',
    narrative: (ctx) => `Atlas delivered "${ctx.event_name}" to ${ctx.platform} but no matching platform record was found within 48 hours.`,
    remediation: () => 'Check that your conversion action tag is firing correctly and that CAPI delivery is succeeding for this event.',
  },
  CAPI_DEDUP_LOW: {
    dimension: 'delivery',
    severity: 'warning',
    narrative: (ctx) => `Meta CAPI deduplication rate for "${ctx.event_name}" is ${ctx.dedup_rate}% over the last 7 days (threshold: 70%).`,
    remediation: () => 'Ensure each CAPI event has a unique event_id matching the browser pixel event_id for the same conversion.',
  },
  EMQ_LOW: {
    dimension: 'delivery',
    severity: 'warning',
    narrative: (ctx) => `Meta Event Match Quality for "${ctx.event_name}" is ${ctx.emq} (threshold: 6.0).`,
    remediation: () => 'Include more customer data parameters (email, phone, fbclid) in your CAPI events to improve match quality.',
  },
  ATTRIBUTION_MODEL_MISMATCH: {
    dimension: 'config',
    severity: 'warning',
    narrative: (ctx) => `Conversion action "${ctx.conversion_name}" uses ${ctx.observed_model} attribution, but the strategy brief recommends ${ctx.expected_model}.`,
    remediation: (ctx) => `Change the attribution model on "${ctx.conversion_name}" in Google Ads to ${ctx.expected_model}.`,
  },
  COUNTING_TYPE_MISMATCH: {
    dimension: 'config',
    severity: 'warning',
    narrative: (ctx) => `Conversion action "${ctx.conversion_name}" is set to count ${ctx.observed_counting} but the brief recommends ${ctx.expected_counting}.`,
    remediation: (ctx) => `Update the counting method on "${ctx.conversion_name}" in Google Ads to ${ctx.expected_counting}.`,
  },
  LOOKBACK_WINDOW_SHORT: {
    dimension: 'config',
    severity: 'info',
    narrative: (ctx) => `Conversion action "${ctx.conversion_name}" has a ${ctx.observed_days}-day click lookback window, which is below the platform default of ${ctx.expected_days} days.`,
    remediation: (ctx) => `Extend the lookback window on "${ctx.conversion_name}" to at least ${ctx.expected_days} days.`,
  },
  AEM_PRIORITY_TOO_LOW: {
    dimension: 'config',
    severity: 'critical',
    narrative: (ctx) => `"${ctx.conversion_name}" is ranked position ${ctx.aem_priority} in Meta's Aggregated Event Measurement priority list. Events ranked 9 or lower are not used for campaign optimisation.`,
    remediation: (ctx) => `Reorder your AEM pixel events so that "${ctx.conversion_name}" appears in positions 1–8.`,
  },
  VALUE_SETTINGS_MISSING: {
    dimension: 'config',
    severity: 'warning',
    narrative: (ctx) => `Conversion action "${ctx.conversion_name}" has no default value configured, but the strategy brief recommends value-based bidding for this objective.`,
    remediation: (ctx) => `Set a default conversion value on "${ctx.conversion_name}" in Google Ads, or pass dynamic values via the gtag/CAPI payload.`,
  },
  WRONG_PRIMARY_CONVERSION: {
    dimension: 'alignment',
    severity: 'critical',
    narrative: (ctx) => `Campaign "${ctx.campaign_name}" is optimising on "${ctx.observed_conversion}" but the strategy brief specifies "${ctx.expected_conversion}" as the primary conversion.`,
    remediation: (ctx) => `Update campaign "${ctx.campaign_name}" to use "${ctx.expected_conversion}" as its primary optimisation target.`,
  },
  MISSING_PRIMARY_CONVERSION: {
    dimension: 'alignment',
    severity: 'critical',
    narrative: (ctx) => `The strategy brief specifies "${ctx.expected_conversion}" as the primary conversion for objective "${ctx.objective_name}", but this conversion action does not exist in the ${ctx.platform} account.`,
    remediation: (ctx) => `Create a conversion action named "${ctx.expected_conversion}" in ${ctx.platform} and ensure it is tagged correctly.`,
  },
  SUPPRESSION_USED_AS_PRIMARY: {
    dimension: 'alignment',
    severity: 'critical',
    narrative: (ctx) => `The strategy brief marks "${ctx.conversion_name}" as a suppression conversion, but campaign "${ctx.campaign_name}" is using it as its primary optimisation target.`,
    remediation: (ctx) => `Remove "${ctx.conversion_name}" from the primary conversion list on campaign "${ctx.campaign_name}". This event should not be used for bidding optimisation.`,
  },
  VOLUME_DELTA_EXCEEDED: {
    dimension: 'volume',
    severity: 'warning',
    narrative: (ctx) => `Platform-recorded count for "${ctx.event_name}" on ${ctx.event_date} is ${ctx.observed_count} vs Atlas-delivered ${ctx.expected_count} (${ctx.delta_pct}% delta, tolerance ±${ctx.tolerance_pct}%).`,
    remediation: () => 'Check CAPI delivery logs for this event on this date. High deltas may indicate tag firing gaps or attribution window mismatches.',
  },
  GA4_VOLUME_DIVERGENCE: {
    dimension: 'volume',
    severity: 'info',
    narrative: (ctx) => `GA4 recorded ${ctx.ga4_count} "${ctx.event_name}" events on ${ctx.event_date} vs ${ctx.platform_count} recorded by ${ctx.platform} (${ctx.delta_pct}% divergence).`,
    remediation: () => 'Review cross-channel attribution and consent mode configuration. Some divergence is normal due to ITP/Safari restrictions.',
  },
};

export function buildNarrative(code: FindingCode, ctx: Record<string, string>): string {
  return FINDING_META[code]?.narrative(ctx) ?? code;
}

export function buildRemediation(code: FindingCode, ctx: Record<string, string>): string {
  return FINDING_META[code]?.remediation(ctx) ?? '';
}

export function getSeverity(code: FindingCode): FindingSeverity {
  return FINDING_META[code]?.severity ?? 'info';
}

export function getDimension(code: FindingCode): FindingDimension {
  return FINDING_META[code]?.dimension ?? 'config';
}
