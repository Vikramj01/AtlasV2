/**
 * Google Tag Topology PRD §6.4 (Sprint 3) — four IHC tag_configuration rules.
 *
 * Container JSON can show which Google tags exist and what each is classified
 * as (googleTagClassifier.ts), but NOT whether destinations are combined on one
 * Google tag — that lives in Google's tag admin. So these rules read two
 * inputs: the container, and `AuditData.google_tag_topology` (resolved by the
 * caller before rules run; "resolve outside, read inside").
 *
 * Copy only states claims the PRD §1.2 marks Verified. The AW-primary
 * cross-domain lock is practitioner-reported and not yet reproduced (U4), so
 * it's phrased "reported to prevent" — never as fact.
 */
import type { AuditData, GTMContainerSnapshot, GTMTag, ValidationResult, Severity } from '@/types/audit';
import { classifyGoogleTag, kindFromGoogleId } from '../google/googleTagClassifier';

const LAYER = 'tag_configuration' as const;

/** Trigger types that fire a tag on every page. */
const SITEWIDE_TRIGGER_TYPES = new Set(['PAGEVIEW', 'INIT', 'INITIALIZATION', 'CONSENT_INIT']);

function skipped(rule_id: string, found: string): ValidationResult {
  return {
    rule_id,
    validation_layer: LAYER,
    status: 'skipped',
    severity: 'low',
    technical_details: { found, expected: 'See rule description', evidence: [`Rule skipped — ${found}`] },
  };
}

export function isSitewide(tag: GTMTag, container: GTMContainerSnapshot): boolean {
  if (tag.firingTriggerId.length === 0) return false;
  return tag.firingTriggerId.some((id) => {
    const trig = container.triggers.find((t) => t.triggerId === id);
    if (!trig || !SITEWIDE_TRIGGER_TYPES.has(trig.type)) return false;
    const hasFilter =
      (trig.filter?.length ?? 0) > 0 ||
      ((trig.autoEventFilter as unknown[] | undefined)?.length ?? 0) > 0 ||
      ((trig.customEventFilter as unknown[] | undefined)?.length ?? 0) > 0;
    return !hasFilter;
  });
}

/** True when the container shows an intent to use Google Ads: an Ads tag type, or an AW- constant. */
export function hasAdsDestination(container: GTMContainerSnapshot): boolean {
  if (container.tags.some((t) => t.type === 'awct' || t.type === 'asp' || t.type === 'sp')) return true;
  return container.variables.some(
    (v) => v.type === 'c' && /^AW-/i.test(v.parameter?.find((p) => p.key === 'value')?.value?.trim() ?? ''),
  );
}

/** True when a sitewide Google tag whose ID classifies as Google Ads is present. */
export function hasSitewideAdsGoogleTag(container: GTMContainerSnapshot): boolean {
  return container.tags.some(
    (t) => t.type === 'googtag' && classifyGoogleTag(t, container).kind === 'google_ads' && isSitewide(t, container),
  );
}

// ── GOOGLE_ADS_GOOGLE_TAG_MISSING ─────────────────────────────────────────────

export const GOOGLE_ADS_GOOGLE_TAG_MISSING = {
  rule_id: 'GOOGLE_ADS_GOOGLE_TAG_MISSING',
  validation_layer: LAYER,
  severity: 'high' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    const container = auditData.gtmContainer;
    if (!container) return skipped(this.rule_id, 'No GTM container connected');
    if (!hasAdsDestination(container)) return skipped(this.rule_id, 'No Google Ads destination in this container');

    const adsGoogleTags = container.tags.filter(
      (t) => t.type === 'googtag' && classifyGoogleTag(t, container).kind === 'google_ads' && isSitewide(t, container),
    ); // same predicate as hasSitewideAdsGoogleTag(); kept as a list to name the tag in the pass evidence

    if (adsGoogleTags.length > 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: LAYER,
        status: 'pass',
        severity: this.severity,
        technical_details: {
          found: `Sitewide Google tag for the Google Ads destination present ("${adsGoogleTags[0].name}")`,
          expected: 'A Google tag for the Google Ads (AW-) destination firing on every page',
          evidence: ['Ads Google tag present'],
        },
      };
    }

    const topology = auditData.google_tag_topology;
    const combinedAds = topology?.combined_tags.find((t) => t.destination_ids.some((d) => kindFromGoogleId(d) === 'google_ads'));

    // Covered today by a combined Google tag: not missing, but splitting without
    // adding this tag would break Ads coverage.
    if (combinedAds) {
      return {
        rule_id: this.rule_id,
        validation_layer: LAYER,
        status: 'fail',
        severity: 'low',
        technical_details: {
          found: `No separate Google tag for the Google Ads destination; it is currently covered by the combined Google tag ${combinedAds.google_tag_id}`,
          expected: 'A Google tag for the Google Ads (AW-) destination firing on every page',
          evidence: [
            `Combined Google tag ${combinedAds.google_tag_id} carries: ${combinedAds.destination_ids.join(', ')}`,
            'Splitting these destinations in Google tag settings without first adding a Google tag for the Ads ID in GTM will break Google Ads coverage',
          ],
        },
        ...(topology?.strength === 'assumed' ? { confidence: 'confirm' as const } : {}),
      };
    }

    const unknown = !topology || topology.verdict === 'UNKNOWN';
    return {
      rule_id: this.rule_id,
      validation_layer: LAYER,
      status: 'fail',
      severity: this.severity,
      technical_details: {
        found: 'No sitewide Google tag for the Google Ads destination was found in this container',
        expected: 'Google needs a Google tag for each ads product in GTM, in addition to the Conversion Linker and conversion tags',
        evidence: [
          'This container has Google Ads conversion tags or an AW- ID, but no Google tag carrying the AW- ID that fires on every page',
          ...(unknown ? ['Whether this client\'s Google tags are combined in Google tag settings is not known — if they are, the Ads destination may still be covered'] : []),
        ],
      },
      ...(unknown || topology?.strength === 'assumed' ? { confidence: 'confirm' as const } : {}),
    };
  },
};

// ── GOOGLE_TAG_COMBINED ───────────────────────────────────────────────────────

export const GOOGLE_TAG_COMBINED = {
  rule_id: 'GOOGLE_TAG_COMBINED',
  validation_layer: LAYER,
  severity: 'medium' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    const topology = auditData.google_tag_topology;
    if (!topology || topology.verdict === 'UNKNOWN') return skipped(this.rule_id, 'Google tag topology is not known for this client');

    if (topology.combined_tags.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: LAYER,
        status: 'pass',
        severity: this.severity,
        technical_details: {
          found: 'No Google tag carries more than one destination',
          expected: 'One Google tag per destination',
          evidence: ['No combined Google tag observed'],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: LAYER,
      status: 'fail',
      severity: this.severity,
      technical_details: {
        found: `${topology.combined_tags.length} Google tag${topology.combined_tags.length > 1 ? 's' : ''} carry${topology.combined_tags.length > 1 ? '' : 'es'} more than one destination`,
        expected: 'One Google tag per destination, so settings and consent for one destination are not shared with another',
        evidence: topology.combined_tags.map(
          (t) => `Google tag ${t.google_tag_id} (primary ${t.primary_destination_id ?? 'unknown'}) carries: ${t.destination_ids.join(', ')}`,
        ),
      },
      ...(topology.strength === 'assumed' ? { confidence: 'confirm' as const } : {}),
    };
  },
};

// ── GOOGLE_TAG_COMBINED_ADS_PRIMARY ───────────────────────────────────────────

export const GOOGLE_TAG_COMBINED_ADS_PRIMARY = {
  rule_id: 'GOOGLE_TAG_COMBINED_ADS_PRIMARY',
  validation_layer: LAYER,
  severity: 'high' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    const topology = auditData.google_tag_topology;
    if (!topology || topology.verdict === 'UNKNOWN') return skipped(this.rule_id, 'Google tag topology is not known for this client');

    if (topology.verdict !== 'COMBINED_ADS_PRIMARY') {
      return {
        rule_id: this.rule_id,
        validation_layer: LAYER,
        status: 'pass',
        severity: this.severity,
        technical_details: {
          found: 'No Google tag has a Google Ads or Floodlight primary ID combined with GA4',
          expected: 'GA4 not combined under an Ads-primary Google tag',
          evidence: ['No Ads-primary combined Google tag observed'],
        },
      };
    }

    const hasSecondaryDomains = (auditData.client_secondary_domains?.length ?? 0) > 0;
    const severity: Severity = hasSecondaryDomains ? 'high' : 'medium';
    const adsPrimary = topology.combined_tags.filter((t) => {
      const k = kindFromGoogleId(t.primary_destination_id ?? '');
      return (k === 'google_ads' || k === 'floodlight') && t.destination_ids.some((d) => kindFromGoogleId(d) === 'ga4');
    });

    return {
      rule_id: this.rule_id,
      validation_layer: LAYER,
      status: 'fail',
      severity,
      technical_details: {
        found: 'GA4 shares a Google tag whose primary ID is a Google Ads or Floodlight ID',
        expected: 'GA4 on its own Google tag, so GA4 settings such as cross-domain are configured on the GA4 tag',
        evidence: [
          ...adsPrimary.map((t) => `Google tag ${t.google_tag_id} (primary ${t.primary_destination_id}) carries: ${t.destination_ids.join(', ')}`),
          // U4 (PRD §17): practitioner-reported, not yet reproduced — never stated as fact.
          'With an Ads ID as the primary ID, GA4 cross-domain settings are reported to be non-editable in the GA4 interface',
          ...(hasSecondaryDomains
            ? [`This client declares secondary domains (${auditData.client_secondary_domains!.join(', ')}), so cross-domain measurement matters here`]
            : []),
        ],
      },
      ...(topology.strength === 'assumed' ? { confidence: 'confirm' as const } : {}),
    };
  },
};

// ── GOOGLE_TAG_ID_UNCLASSIFIED ────────────────────────────────────────────────

export const GOOGLE_TAG_ID_UNCLASSIFIED = {
  rule_id: 'GOOGLE_TAG_ID_UNCLASSIFIED',
  validation_layer: LAYER,
  severity: 'low' as const,
  affected_platforms: ['All'],

  test(auditData: AuditData): ValidationResult {
    const container = auditData.gtmContainer;
    if (!container) return skipped(this.rule_id, 'No GTM container connected');

    const unclassified = container.tags
      .filter((t) => t.type === 'googtag')
      .map((t) => ({ tag: t, c: classifyGoogleTag(t, container) }))
      .filter(({ c }) => c.kind === 'google_tag' || c.resolution === 'unresolvable');

    if (unclassified.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: LAYER,
        status: 'pass',
        severity: this.severity,
        technical_details: {
          found: 'Every Google tag carries a recognisable destination ID',
          expected: 'Each Google tag classifies as GA4, Google Ads or Floodlight',
          evidence: ['All Google tags classified'],
        },
      };
    }

    return {
      rule_id: this.rule_id,
      validation_layer: LAYER,
      status: 'fail',
      severity: this.severity,
      technical_details: {
        found: `${unclassified.length} Google tag${unclassified.length > 1 ? 's' : ''} whose destinations could not be determined`,
        expected: 'Each Google tag classifies as GA4, Google Ads or Floodlight',
        evidence: unclassified.map(({ tag, c }) =>
          c.kind === 'google_tag'
            ? `"${tag.name}" uses a GT- Google tag ID (${c.resolvedTagId}), which is not tied to a single product and may serve several destinations`
            : `"${tag.name}" takes its ID from "${c.rawTagId || '(none)'}", which Atlas cannot resolve to a fixed ID`,
        ),
      },
      confidence: 'confirm',
    };
  },
};

export const GOOGLE_TAG_TOPOLOGY_RULES = [
  GOOGLE_ADS_GOOGLE_TAG_MISSING,
  GOOGLE_TAG_COMBINED,
  GOOGLE_TAG_COMBINED_ADS_PRIMARY,
  GOOGLE_TAG_ID_UNCLASSIFIED,
];
