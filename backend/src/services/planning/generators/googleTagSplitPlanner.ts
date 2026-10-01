/**
 * Google Tag Topology PRD §7.2 (Sprint 4) — builds a split-ready container
 * DELTA for a client's existing GTM container.
 *
 * A delta, never a regenerated container: it contains only what is missing
 * (an Ads and/or GA4 Google tag, their CONST ID variables, a Conversion
 * Linker if the linker decision says one is needed, and one uniquely-named
 * sitewide trigger for them). It NEVER deletes or modifies an existing client
 * object — anything that would collide (a same-name object, an existing
 * Google tag for the ID that isn't sitewide, several IDs of one kind) stops
 * planning and is returned as a conflict for the operator.
 *
 * Pure: no I/O. Reuses buildGoogleTagInfrastructure() so the tags are exactly
 * what the generator would produce (Sprint 2), then filters to what is absent.
 *
 * UNVERIFIED (PRD §17 U1): the Ads `googtag` parameter shape comes from the
 * generator and is a best-effort reconstruction — re-verify against a genuine
 * GTM export before a delta reaches a real client.
 */
import type { GTMContainerSnapshot, GTMTag } from '@/types/audit';
import type { GTMContainerJSON, GTMTagDef, GTMTriggerDef, GTMVariableDef } from './gtmContainerGenerator';
import { buildAllPagesTrigger, buildGoogleTagInfrastructure } from './renderer/googleTagArchitecture';
import { validateGTMContainer } from './gtmSchemaValidator';
import { classifyGoogleTag, kindFromGoogleId } from '@/services/google/googleTagClassifier';
import type { TopologyVerdictResult } from '@/services/google/googleTagTopology';

export const SPLIT_TRIGGER_NAME = 'Atlas - Google tag split - All Pages';
const ADS_TAG_NAME = 'Google Tag - Google Ads';
const GA4_TAG_NAME = 'GA4 - Config';
const LINKER_TAG_NAME = 'Google Ads - Conversion Linker';
const ADS_CONST = 'CONST - Google Ads Conversion ID';
const GA4_CONST = 'CONST - GA4 Measurement ID';
const SITEWIDE_TRIGGER_TYPES = new Set(['PAGEVIEW', 'INIT', 'INITIALIZATION', 'CONSENT_INIT']);

export type SplitConflictCode =
  | 'multiple_destinations'
  | 'existing_not_sitewide'
  | 'name_conflict'
  | 'invalid_delta';

export interface SplitConflict {
  code: SplitConflictCode;
  message: string;
}

export interface SplitDiff {
  tags_added: string[];
  variables_added: string[];
  triggers_added: string[];
  already_covered: string[];
}

export interface SplitPlan {
  delta: GTMContainerJSON | null;
  diff: SplitDiff;
  conflicts: SplitConflict[];
  /** Destinations the plan was built for (null when the container shows none). */
  destinations: { ga4: string | null; google_ads: string | null };
}

export interface SplitPlanInput {
  container: GTMContainerSnapshot;
  topology?: Pick<TopologyVerdictResult, 'combined_tags'> | null;
  secondaryDomains?: string[];
  now?: Date;
}

function paramValue(tag: GTMTag, key: string): string | undefined {
  return tag.parameter?.find((p) => p.key === key)?.value;
}

function constValue(variable: { type: string; parameter?: Array<{ key: string; value?: string }> }): string | undefined {
  return variable.type === 'c' ? variable.parameter?.find((p) => p.key === 'value')?.value?.trim() : undefined;
}

function isSitewide(tag: GTMTag, container: GTMContainerSnapshot): boolean {
  return tag.firingTriggerId.some((id) => {
    const trig = container.triggers.find((t) => t.triggerId === id);
    if (!trig || !SITEWIDE_TRIGGER_TYPES.has(trig.type)) return false;
    const filtered =
      (trig.filter?.length ?? 0) > 0 ||
      ((trig.autoEventFilter as unknown[] | undefined)?.length ?? 0) > 0 ||
      ((trig.customEventFilter as unknown[] | undefined)?.length ?? 0) > 0;
    return !filtered;
  });
}

/** Every distinct GA4 (G-) and Ads (AW-) destination ID the container or topology shows. */
export function collectDestinationIds(
  container: GTMContainerSnapshot,
  topology?: Pick<TopologyVerdictResult, 'combined_tags'> | null,
): { ga4: string[]; ads: string[] } {
  const found = new Set<string>();
  for (const t of container.tags) {
    if (t.type === 'googtag' || t.type === 'gaawc') {
      const id = classifyGoogleTag(t, container).resolvedTagId ?? paramValue(t, 'measurementId') ?? paramValue(t, 'tagId');
      if (id) found.add(id);
    }
  }
  for (const v of container.variables) {
    const val = constValue(v);
    if (val && /^(G|AW)-/i.test(val)) found.add(val);
  }
  for (const c of topology?.combined_tags ?? []) for (const d of c.destination_ids) found.add(d);

  const all = [...found].filter((id) => !id.startsWith('{{'));
  return {
    ga4: all.filter((id) => kindFromGoogleId(id) === 'ga4'),
    ads: all.filter((id) => kindFromGoogleId(id) === 'google_ads'),
  };
}

export function planGoogleTagSplit(input: SplitPlanInput): SplitPlan {
  const { container, topology } = input;
  const secondaryDomains = input.secondaryDomains ?? [];
  const conflicts: SplitConflict[] = [];
  const diff: SplitDiff = { tags_added: [], variables_added: [], triggers_added: [], already_covered: [] };

  const ids = collectDestinationIds(container, topology);
  const result = (delta: GTMContainerJSON | null): SplitPlan => ({
    delta,
    diff,
    conflicts,
    destinations: { ga4: ids.ga4[0] ?? null, google_ads: ids.ads[0] ?? null },
  });

  if (ids.ga4.length > 1 || ids.ads.length > 1) {
    conflicts.push({
      code: 'multiple_destinations',
      message: `More than one destination of the same kind was found (GA4: ${ids.ga4.join(', ') || 'none'}; Google Ads: ${ids.ads.join(', ') || 'none'}). Atlas plans one GA4 and one Google Ads destination at a time and will not guess which to split.`,
    });
    return result(null);
  }

  const ga4Id = ids.ga4[0] ?? null;
  const adsId = ids.ads[0] ?? null;
  if (!ga4Id && !adsId) return result(null);

  // Which destinations already have a sitewide Google tag carrying exactly their ID?
  const googtags = container.tags.filter((t) => t.type === 'googtag');
  const coverage = (id: string | null): 'covered' | 'not_sitewide' | 'missing' => {
    if (!id) return 'covered'; // nothing to cover
    const matching = googtags.filter((t) => classifyGoogleTag(t, container).resolvedTagId === id);
    if (matching.length === 0) return 'missing';
    return matching.some((t) => isSitewide(t, container)) ? 'covered' : 'not_sitewide';
  };
  const adsCoverage = coverage(adsId);
  const ga4Coverage = ga4Id ? coverage(ga4Id) : 'covered';

  for (const [label, id, cov] of [['Google Ads', adsId, adsCoverage], ['GA4', ga4Id, ga4Coverage]] as const) {
    if (id && cov === 'covered') diff.already_covered.push(`${label} (${id}) already has a sitewide Google tag`);
    if (id && cov === 'not_sitewide') {
      conflicts.push({
        code: 'existing_not_sitewide',
        message: `A Google tag for ${label} (${id}) already exists but does not fire on every page. Atlas does not modify existing tags — fix its trigger in GTM, or remove it, then plan again.`,
      });
    }
  }
  if (conflicts.length > 0) return result(null);

  const needAds = adsId !== null && adsCoverage === 'missing';
  const needGa4 = ga4Id !== null && ga4Coverage === 'missing';
  const needLinkerCheck = adsId !== null;
  const hasLinker = container.tags.some((t) => t.type === 'gclidw');

  // Server-side routing carried over from an existing GA4 Google tag, so the linker decision sees it.
  const routedTag = googtags.find((t) => paramValue(t, 'enableSendToServerContainer') === 'true');
  const serverContainerUrl = routedTag ? paramValue(routedTag, 'serverContainerUrl') : undefined;

  let nextTag = 9001;
  let nextVar = 9001;
  const triggerId = '9001';
  const built = buildGoogleTagInfrastructure(
    {
      ...(ga4Id ? { ga4: { measurementId: ga4Id } } : {}),
      ...(adsId ? { googleAds: { conversionId: adsId } } : {}),
    },
    {
      allPagesTriggerId: triggerId,
      secondaryDomains,
      serverContainerUrl,
      nextTagId: () => String(nextTag++),
      nextVarId: () => String(nextVar++),
    },
  );

  const keepTag = (t: GTMTagDef): boolean => {
    if (t.name === ADS_TAG_NAME) return needAds;
    if (t.name === GA4_TAG_NAME) return needGa4;
    if (t.name === LINKER_TAG_NAME) return needLinkerCheck && !hasLinker;
    return false;
  };
  const tags: GTMTagDef[] = built.tags.filter(keepTag);
  const keepVar = (v: GTMVariableDef): boolean =>
    (v.name === ADS_CONST && needAds) || (v.name === GA4_CONST && needGa4);
  const variables: GTMVariableDef[] = built.variables.filter(keepVar);

  if (tags.length === 0) {
    if (hasLinker && adsId) diff.already_covered.push('A Conversion Linker tag already exists');
    return result(null);
  }

  // Never collide with an existing object by name; never modify one.
  for (const t of tags) {
    if (container.tags.some((e) => e.name === t.name)) {
      conflicts.push({ code: 'name_conflict', message: `A tag named "${t.name}" already exists in this container. Atlas does not modify existing tags.` });
    }
  }
  const keptVariables: GTMVariableDef[] = [];
  for (const v of variables) {
    const existing = container.variables.find((e) => e.name === v.name);
    if (!existing) {
      keptVariables.push(v);
    } else if (constValue(existing) === v.parameter.find((p) => p.key === 'value')?.value) {
      diff.already_covered.push(`Variable "${v.name}" already exists with the same value`);
    } else {
      conflicts.push({ code: 'name_conflict', message: `A variable named "${v.name}" already exists with a different value. Atlas does not modify existing variables.` });
    }
  }
  if (container.triggers.some((e) => e.name === SPLIT_TRIGGER_NAME)) {
    conflicts.push({ code: 'name_conflict', message: `A trigger named "${SPLIT_TRIGGER_NAME}" already exists in this container.` });
  }
  if (conflicts.length > 0) return result(null);

  const trigger: GTMTriggerDef = { ...buildAllPagesTrigger(triggerId), name: SPLIT_TRIGGER_NAME };

  const now = (input.now ?? new Date()).toISOString().replace('T', ' ').slice(0, 19);
  const delta: GTMContainerJSON = {
    exportFormatVersion: 2,
    exportTime: now,
    containerVersion: {
      path: 'accounts/0/containers/0/versions/0',
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: 'Atlas - Google tag split',
      description: 'Adds a Google tag per destination. Review in GTM, then publish — Atlas never publishes automatically.',
      container: {
        path: 'accounts/0/containers/0', accountId: '0', containerId: '0',
        name: 'Atlas - Google tag split', publicId: 'GTM-ATLAS', usageContext: ['WEB'],
        fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: tags,
      trigger: [trigger],
      variable: keptVariables,
      folder: [],
      builtInVariable: [],
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };

  const validation = validateGTMContainer(delta);
  if (!validation.valid) {
    conflicts.push({ code: 'invalid_delta', message: `Generated delta failed validation: ${validation.errors.join('; ')}` });
    return result(null);
  }

  diff.tags_added = tags.map((t) => t.name);
  diff.variables_added = keptVariables.map((v) => v.name);
  diff.triggers_added = [trigger.name];
  return result(delta);
}
