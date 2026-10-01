/**
 * Google Tag Topology PRD §4 (Sprint 1) — classify a Google tag by the
 * destination ID it carries, never by its GTM tag type.
 *
 * `googtag` is the unified Google tag type and can carry a GA4 (`G-`), Google
 * Ads (`AW-`), Floodlight (`DC-`) or generic (`GT-`) ID. Treating the type
 * itself as "GA4" (what several rules did before this module) mislabels any
 * client who correctly runs a separate Google tag for their Ads ID.
 *
 * Pure: no I/O. Structural input types so it works against both the audit
 * path's `GTMTag`/`GTMVariable` and the generator's `GTMTagDef`/`GTMVariableDef`.
 *
 * Resolution: Atlas's own generator writes the ID through a constant (`c`)
 * variable (`{{CONST - GA4 Measurement ID}}`). A tag ID sourced from anything
 * non-constant (lookup table, dataLayer variable, ...) is `unresolvable` and
 * classifies `unknown` — the tag NAME is never used to guess.
 */

export type GoogleDestinationKind = 'ga4' | 'google_ads' | 'floodlight' | 'google_tag' | 'unknown';

export interface ClassifiableTag {
  tagId?: string;
  type?: string;
  parameter?: Array<{ key?: string; value?: string }>;
}

export interface ClassifiableVariable {
  name?: string;
  type?: string;
  parameter?: Array<{ key?: string; value?: string }>;
}

export interface ClassifiableContainer {
  variables?: ClassifiableVariable[];
}

export interface ClassifiedGoogleTag {
  gtmTagId: string;
  rawTagId: string;
  resolvedTagId: string | null;
  kind: GoogleDestinationKind;
  resolution: 'literal' | 'constant_variable' | 'unresolvable';
}

const VARIABLE_REF = /^\{\{(.+)\}\}$/;

export function kindFromGoogleId(id: string): GoogleDestinationKind {
  const upper = id.trim().toUpperCase();
  if (upper.startsWith('G-')) return 'ga4';
  if (upper.startsWith('AW-')) return 'google_ads';
  if (upper.startsWith('DC-')) return 'floodlight';
  if (upper.startsWith('GT-')) return 'google_tag';
  return 'unknown';
}

export function classifyGoogleTag(
  tag: ClassifiableTag,
  container: ClassifiableContainer = {},
): ClassifiedGoogleTag {
  const gtmTagId = tag.tagId ?? '';

  // Legacy GA4 Config tag type is GA4-only; no ID resolution needed.
  if (tag.type === 'gaawc') {
    const raw = tag.parameter?.find((p) => p.key === 'measurementId' || p.key === 'tagId')?.value ?? '';
    return { gtmTagId, rawTagId: raw, resolvedTagId: null, kind: 'ga4', resolution: 'literal' };
  }

  const rawTagId = tag.parameter?.find((p) => p.key === 'tagId')?.value ?? '';
  if (!rawTagId) {
    return { gtmTagId, rawTagId, resolvedTagId: null, kind: 'unknown', resolution: 'unresolvable' };
  }

  const ref = VARIABLE_REF.exec(rawTagId.trim());
  if (!ref) {
    return {
      gtmTagId,
      rawTagId,
      resolvedTagId: rawTagId.trim(),
      kind: kindFromGoogleId(rawTagId),
      resolution: 'literal',
    };
  }

  const variable = container.variables?.find((v) => v.name === ref[1]);
  const value = variable?.type === 'c' ? variable.parameter?.find((p) => p.key === 'value')?.value : undefined;
  // A constant whose value is itself another {{variable}} is not resolved further.
  if (!value || VARIABLE_REF.test(value.trim())) {
    return { gtmTagId, rawTagId, resolvedTagId: null, kind: 'unknown', resolution: 'unresolvable' };
  }
  return {
    gtmTagId,
    rawTagId,
    resolvedTagId: value.trim(),
    kind: kindFromGoogleId(value),
    resolution: 'constant_variable',
  };
}

/**
 * Whether a tag should be treated as a GA4 Config tag by GA4-only rules.
 * `gaawc` and a `googtag` of kind `ga4` are definite; a `googtag` of kind
 * `unknown`/`google_tag` is included but `definite: false` so findings raised
 * from it carry `confidence: 'confirm'`. An Ads/Floodlight `googtag` is excluded.
 */
export function ga4ConfigTagMatch(
  tag: ClassifiableTag,
  container: ClassifiableContainer = {},
): { match: boolean; definite: boolean } {
  if (tag.type === 'gaawc') return { match: true, definite: true };
  if (tag.type !== 'googtag') return { match: false, definite: false };
  const { kind } = classifyGoogleTag(tag, container);
  if (kind === 'ga4') return { match: true, definite: true };
  if (kind === 'unknown' || kind === 'google_tag') return { match: true, definite: false };
  return { match: false, definite: false };
}

const ADS = ['ad_storage', 'ad_user_data'];
const ANALYTICS = ['analytics_storage'];

/** Consent types a Google tag requires, by destination kind. `googtag` only. */
export function requiredConsentTypesForGoogleTag(kind: GoogleDestinationKind): {
  types: string[];
  definite: boolean;
} {
  switch (kind) {
    case 'ga4': return { types: ANALYTICS, definite: true };
    case 'google_ads':
    case 'floodlight': return { types: ADS, definite: true };
    default: return { types: [...ANALYTICS, ...ADS], definite: false };
  }
}
