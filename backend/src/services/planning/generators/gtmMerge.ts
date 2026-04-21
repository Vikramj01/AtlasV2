/**
 * GTM Merge Service
 *
 * Compares an Atlas-generated GTM container with an existing GTM container
 * the user already has in their workspace, and produces:
 *   - will_add      — new Atlas tags not in the existing container
 *   - will_overwrite — Atlas tags whose name matches an existing tag
 *   - untouched     — existing tags unaffected by Atlas
 *   - merged_container — the combined JSON, safe to import
 *
 * Merge strategy: Atlas tags take precedence by name. Triggers and variables
 * follow the same logic. The merged container keeps existing items and
 * overlays/appends Atlas items (Merge → Rename Conflicting behaviour).
 */

export interface GTMMergeSummary {
  will_add:       string[];
  will_overwrite: string[];
  untouched:      string[];
}

export interface GTMMergeResult {
  summary:          GTMMergeSummary;
  merged_container: Record<string, unknown>;
}

interface Named { name?: string }

function nameMap<T extends Named>(items: T[]): Map<string, T> {
  return new Map(items.filter((i) => i.name).map((i) => [i.name!, i]));
}

function mergeByName<T extends Named>(existing: T[], atlas: T[]): T[] {
  const atlasNames = new Set(atlas.map((i) => i.name).filter(Boolean) as string[]);
  return [
    ...existing.filter((i) => !atlasNames.has(i.name ?? '')),
    ...atlas,
  ];
}

export function mergeGTMContainers(
  atlasContainer: Record<string, unknown>,
  existingContainer: Record<string, unknown>,
): GTMMergeResult {
  const atlasCv  = (atlasContainer.containerVersion    as Record<string, unknown>) ?? {};
  const existCv  = (existingContainer.containerVersion as Record<string, unknown>) ?? {};

  const atlasTags:    Named[] = (atlasCv.tag    as Named[]) ?? [];
  const existTags:    Named[] = (existCv.tag    as Named[]) ?? [];
  const atlasTriggers: Named[] = (atlasCv.trigger as Named[]) ?? [];
  const existTriggers: Named[] = (existCv.trigger as Named[]) ?? [];
  const atlasVars:    Named[] = (atlasCv.variable as Named[]) ?? [];
  const existVars:    Named[] = (existCv.variable as Named[]) ?? [];

  // ── Tag diff ──────────────────────────────────────────────────────────────
  const existTagMap  = nameMap(existTags);
  const atlasTagMap  = nameMap(atlasTags);

  const will_add: string[]       = [];
  const will_overwrite: string[] = [];
  const untouched: string[]      = [];

  for (const tag of atlasTags) {
    if (!tag.name) continue;
    if (existTagMap.has(tag.name)) {
      will_overwrite.push(tag.name);
    } else {
      will_add.push(tag.name);
    }
  }

  for (const tag of existTags) {
    if (tag.name && !atlasTagMap.has(tag.name)) {
      untouched.push(tag.name);
    }
  }

  // ── Build merged container ────────────────────────────────────────────────
  const mergedTags      = mergeByName(existTags, atlasTags);
  const mergedTriggers  = mergeByName(existTriggers, atlasTriggers);
  const mergedVars      = mergeByName(existVars, atlasVars);

  const merged_container: Record<string, unknown> = {
    ...atlasContainer,
    containerVersion: {
      ...atlasCv,
      // Preserve existing container metadata if present
      ...(existCv.container ? { container: existCv.container } : {}),
      tag:      mergedTags,
      trigger:  mergedTriggers,
      variable: mergedVars,
    },
  };

  return {
    summary: { will_add, will_overwrite, untouched },
    merged_container,
  };
}
