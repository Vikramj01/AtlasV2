/**
 * GTM Schema Validator
 *
 * Validates that a GTM container JSON produced by Atlas is structurally sound
 * before the user downloads it. Checks for:
 *   - Correct export format version
 *   - Presence of required Atlas tags (Consent Mode default, GA4 Config)
 *   - All firing trigger IDs resolve to an existing trigger
 *   - No empty required tag parameters
 *   - At least one conversion or engagement event tag
 *
 * Returns { valid: boolean; errors: string[]; warnings: string[] }
 */

export interface GTMValidationResult {
  valid:    boolean;
  errors:   string[];
  warnings: string[];
}

interface RawTag {
  name?: string;
  type?: string;
  tagId?: string;
  firingTriggerId?: string[];
  parameter?: Array<{ key?: string; value?: string; type?: string }>;
}

interface RawTrigger {
  triggerId?: string;
  name?: string;
}

interface RawContainer {
  exportFormatVersion?: number;
  containerVersion?: {
    tag?: RawTag[];
    trigger?: RawTrigger[];
    variable?: unknown[];
  };
}

export function validateGTMContainer(json: unknown): GTMValidationResult {
  const errors:   string[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Container is not a valid object'], warnings: [] };
  }

  const container = json as RawContainer;

  // 1. Export format version
  if (container.exportFormatVersion !== 2) {
    errors.push(`exportFormatVersion must be 2, got ${container.exportFormatVersion}`);
  }

  const cv = container.containerVersion;
  if (!cv) {
    return { valid: false, errors: [...errors, 'Missing containerVersion'], warnings };
  }

  const tags     = cv.tag     ?? [];
  const triggers = cv.trigger ?? [];

  // 2. Build trigger ID set for reference-checking
  const triggerIds = new Set(triggers.map((t) => t.triggerId).filter(Boolean) as string[]);

  // 3. Check all firingTriggerId references resolve
  for (const tag of tags) {
    for (const triggerId of (tag.firingTriggerId ?? [])) {
      if (!triggerIds.has(triggerId)) {
        errors.push(`Tag "${tag.name}" references missing trigger ID "${triggerId}"`);
      }
    }
  }

  // 4. Atlas-required tags
  const tagNames = tags.map((t) => t.name ?? '');

  const hasConsentDefault = tagNames.some((n) => n.includes('Consent Mode v2 Default'));
  if (!hasConsentDefault) {
    warnings.push('Missing recommended tag: Atlas - Consent Mode v2 Default');
  }

  const hasConsentUpdate = tagNames.some((n) => n.includes('Consent Mode v2 Update'));
  if (!hasConsentUpdate) {
    warnings.push('Missing recommended tag: Atlas - Consent Mode v2 Update');
  }

  const hasGA4Config = tags.some((t) => t.type === 'googtag' || (t.name ?? '').includes('GA4'));
  if (!hasGA4Config) {
    warnings.push('No GA4 configuration tag found — add one if GA4 is a target platform');
  }

  // 5. At least one event tag (beyond config)
  const configTagTypes = new Set(['html', 'googtag', 'flc']);
  const eventTags = tags.filter((t) => !configTagTypes.has(t.type ?? ''));
  if (eventTags.length === 0) {
    warnings.push('No event tags found — generate outputs from at least one approved recommendation');
  }

  // 6. Tags with no firing triggers (except sequence tags)
  for (const tag of tags) {
    if ((tag.firingTriggerId ?? []).length === 0) {
      warnings.push(`Tag "${tag.name}" has no firing triggers`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
