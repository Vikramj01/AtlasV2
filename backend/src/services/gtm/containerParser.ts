/**
 * GTM Container Parser
 *
 * Normalises GTM container data into GTMContainerSnapshot regardless of whether
 * the input came from the GTM Management API (account.containers[].versions[])
 * or a manually exported container JSON file (exported via GTM UI Admin → Export).
 *
 * Both formats are handled identically downstream by the tag_configuration rules.
 */

import type { GTMContainerSnapshot, GTMTag, GTMTrigger, GTMVariable } from '@/types/audit';

// ── GTM API response shape ────────────────────────────────────────────────────

interface GtmApiTag {
  tagId?: string;
  name?: string;
  type?: string;
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parameter?: GtmParameter[];
  consentSettings?: { consentStatus?: string; consentType?: string[] };
  tagFiringOption?: string;
}

interface GtmApiTrigger {
  triggerId?: string;
  name?: string;
  type?: string;
  filter?: GtmFilter[];
  autoEventFilter?: unknown[];
  customEventFilter?: unknown[];
  parameter?: GtmParameter[];
}

interface GtmApiVariable {
  variableId?: string;
  name?: string;
  type?: string;
  parameter?: GtmParameter[];
}

interface GtmApiBuiltInVariable {
  name?: string;
}

interface GtmParameter {
  type?: string;
  key?: string;
  value?: string;
  list?: unknown[];
}

interface GtmFilter {
  type?: string;
  parameter?: GtmParameter[];
}

// Top-level shapes for both API and exported JSON
interface GtmApiContainerVersion {
  containerVersion?: {
    tag?: GtmApiTag[];
    trigger?: GtmApiTrigger[];
    variable?: GtmApiVariable[];
    builtInVariable?: GtmApiBuiltInVariable[];
    container?: { publicId?: string };
  };
  tag?: GtmApiTag[];
  trigger?: GtmApiTrigger[];
  variable?: GtmApiVariable[];
  builtInVariable?: GtmApiBuiltInVariable[];
  container?: { publicId?: string };
  containerId?: string;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

function normaliseTags(raw: GtmApiTag[] | undefined): GTMTag[] {
  if (!raw) return [];
  return raw.map((t) => ({
    tagId: t.tagId ?? '',
    name: t.name ?? '',
    type: t.type ?? '',
    firingTriggerId: t.firingTriggerId ?? [],
    blockingTriggerId: t.blockingTriggerId,
    parameter: t.parameter as GTMTag['parameter'],
    consentSettings: t.consentSettings
      ? {
          consentStatus: (t.consentSettings.consentStatus ?? 'NOT_SET') as GTMTag['consentSettings'] extends undefined ? never : NonNullable<GTMTag['consentSettings']>['consentStatus'],
          consentType: t.consentSettings.consentType,
        }
      : undefined,
    tagFiringOption: t.tagFiringOption,
  }));
}

function normaliseTriggers(raw: GtmApiTrigger[] | undefined): GTMTrigger[] {
  if (!raw) return [];
  return raw.map((t) => ({
    triggerId: t.triggerId ?? '',
    name: t.name ?? '',
    type: t.type ?? '',
    filter: t.filter as GTMTrigger['filter'],
    autoEventFilter: t.autoEventFilter,
    customEventFilter: t.customEventFilter,
    parameter: t.parameter as GTMTrigger['parameter'],
  }));
}

function normaliseVariables(raw: GtmApiVariable[] | undefined): GTMVariable[] {
  if (!raw) return [];
  return raw.map((v) => ({
    variableId: v.variableId ?? '',
    name: v.name ?? '',
    type: v.type ?? '',
    parameter: v.parameter as GTMVariable['parameter'],
  }));
}

function normaliseBuiltIns(raw: GtmApiBuiltInVariable[] | undefined): string[] {
  if (!raw) return [];
  return raw.map((b) => b.name ?? '').filter(Boolean);
}

// A consent default tag initialises Consent Mode v2 defaults in the container.
// It is identified by type 'consent_init' or by name pattern 'Google Consent Mode'.
function findConsentDefaultTag(tags: GTMTag[]): GTMTag | null {
  return (
    tags.find(
      (t) =>
        t.type === 'consent_init' ||
        t.name.toLowerCase().includes('consent mode') ||
        t.name.toLowerCase().includes('consent initialization'),
    ) ?? null
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parses a GTM container JSON blob (from API or manual export) into the
 * normalised GTMContainerSnapshot used by the tag_configuration rules.
 *
 * Throws on fundamentally malformed input (not an object, missing tags array).
 */
export function parseContainerJson(
  raw: unknown,
  source: 'gtm_api' | 'manual_upload',
): GTMContainerSnapshot {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Container JSON must be a non-null object');
  }

  const data = raw as GtmApiContainerVersion;

  // Handle both wrapped (API live export) and unwrapped (file export) formats
  const version = data.containerVersion ?? data;

  const tags = normaliseTags(version.tag);
  const triggers = normaliseTriggers(version.trigger);
  const variables = normaliseVariables(version.variable);
  const builtIns = normaliseBuiltIns(version.builtInVariable);

  const containerId =
    version.container?.publicId ??
    data.containerId ??
    '';

  return {
    container_id: containerId,
    fetched_at: new Date().toISOString(),
    source,
    tags,
    triggers,
    variables,
    built_in_variables: builtIns,
    consent_default_tag: findConsentDefaultTag(tags),
  };
}

/**
 * Validates that a parsed object has the minimum required structure
 * for a GTM container export before we attempt to parse it.
 */
export function validateContainerJsonShape(raw: unknown): { valid: boolean; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Input must be a JSON object' };
  }
  const data = raw as Record<string, unknown>;
  const version = (data['containerVersion'] ?? data) as Record<string, unknown>;
  if (!Array.isArray(version['tag']) && !Array.isArray(data['tag'])) {
    return {
      valid: false,
      error: 'Container JSON must contain a "tag" array (or a "containerVersion.tag" array)',
    };
  }
  return { valid: true };
}
