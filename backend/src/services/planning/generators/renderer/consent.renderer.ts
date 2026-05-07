/**
 * Consent Renderer — deterministically produces GTM consent settings.
 *
 * Rules:
 *   - Platform measurement tags must NEVER have consentStatus: 'notSet'
 *   - GA4 tags (gaawc, gaawe) → 'needed', analytics_storage
 *   - Ads tags (awct, gclidw, Meta/TikTok/LinkedIn HTML) → 'needed', ad_storage + ad_user_data + ad_personalization
 *   - Infrastructure tags (html consent, click ID, UTM) → 'notNeeded'
 */

export type ConsentPurpose = 'analytics' | 'ads' | 'infrastructure';

export interface ConsentSettings {
  consentStatus: 'needed' | 'notNeeded';
}

/** GTM tag types that require analytics_storage consent. */
const ANALYTICS_TAG_TYPES = new Set(['gaawc', 'gaawe']);

/** GTM tag types that require ad_storage consent. */
const ADS_TAG_TYPES = new Set(['awct', 'gclidw']);

/** HTML tag name prefixes that are ad-platform measurement tags. */
const ADS_HTML_PREFIXES = ['Meta -', 'TikTok -', 'LinkedIn -'];

/** HTML tag name prefixes that are analytics-platform measurement tags. */
const ANALYTICS_HTML_PREFIXES: string[] = [];

/**
 * Derive the consent purpose for a GTM tag from its type and name.
 * Returns 'infrastructure' for non-measurement tags (Consent Mode defaults,
 * click ID capture, UTM capture, Atlas Signal Tag, etc.).
 */
export function consentPurposeForTag(tagType: string, tagName: string): ConsentPurpose {
  if (ANALYTICS_TAG_TYPES.has(tagType)) return 'analytics';
  if (ADS_TAG_TYPES.has(tagType)) return 'ads';
  if (tagType === 'html') {
    if (ADS_HTML_PREFIXES.some(p => tagName.startsWith(p))) return 'ads';
    if (ANALYTICS_HTML_PREFIXES.some(p => tagName.startsWith(p))) return 'analytics';
  }
  return 'infrastructure';
}

/**
 * Render GTM consent settings for a given purpose.
 * Never returns { consentStatus: 'notSet' }.
 */
export function renderConsentSettings(purpose: ConsentPurpose): ConsentSettings {
  switch (purpose) {
    case 'analytics':
      return { consentStatus: 'needed' };
    case 'ads':
      return { consentStatus: 'needed' };
    case 'infrastructure':
      return { consentStatus: 'notNeeded' };
  }
}

/**
 * Convenience: derive and render in one call.
 */
export function consentSettingsForTag(tagType: string, tagName: string): ConsentSettings {
  return renderConsentSettings(consentPurposeForTag(tagType, tagName));
}
