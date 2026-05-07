/**
 * Guide Renderer — produces metadata blocks and placeholder tables for the
 * implementation guide.
 *
 * Rules:
 *   renderMetadataBlock  — all counts derived from IR + container, never hardcoded
 *   derivePlaceholderTable — scans CONST variables only; excludes platforms not
 *                            present in ir.platforms; derives where_to_find per
 *                            variable name pattern
 */

import type { AtlasIR } from '../ir.types';
import type { GTMContainerJSON, GTMVariableDef } from '../gtmContainerGenerator';

// ── Placeholder table ─────────────────────────────────────────────────────────

export interface PlaceholderRow {
  variable_name: string;
  description: string;
  where_to_find: string;
  example: string;
}

/** Placeholder value patterns — values that look like they still need filling in. */
function isPlaceholderValue(val: string | undefined): boolean {
  if (!val || val === '') return true;
  // Stub IDs: G-XXXXXXXXXX, AW-XXXXXXXXX, GTM-XXXXXXX, all-X/0 strings
  if (/^(G|AW|GTM)-[X0-9]+/.test(val)) return true;
  // All caps + dashes only (e.g. REPLACE_WITH_XXX, XXXXXXXXXXXXXXXX)
  if (/^[A-Z0-9_\-]+$/.test(val) && val.length > 4) return true;
  return false;
}

/** Derive documentation for a CONST variable based on its name. */
function docForVariable(name: string): { description: string; where_to_find: string; example: string } {
  if (name === 'CONST - GA4 Measurement ID') {
    return {
      description: 'Google Analytics 4 Measurement ID',
      where_to_find: 'GA4 → Admin → Data Streams → select stream → Measurement ID',
      example: 'G-XXXXXXXXXX',
    };
  }
  if (name === 'CONST - Google Ads Conversion ID') {
    return {
      description: 'Google Ads account conversion ID (shared across all conversions)',
      where_to_find: 'Google Ads → Tools → Conversions → select conversion → Tag setup → Conversion ID',
      example: 'AW-XXXXXXXXX',
    };
  }
  if (name.startsWith('CONST - GAds Conversion Label - ')) {
    const eventName = name.replace('CONST - GAds Conversion Label - ', '');
    return {
      description: `Google Ads conversion label for the "${eventName}" event`,
      where_to_find: `Google Ads → Goals → Conversions → select "${eventName}" conversion → Tag setup → Conversion label`,
      example: 'AbCdEfGhIjKlMnOp12',
    };
  }
  if (name === 'CONST - Meta Pixel ID') {
    return {
      description: 'Meta (Facebook) Pixel ID',
      where_to_find: 'Meta Business Manager → Events Manager → your pixel → Pixel ID',
      example: '1234567890123456',
    };
  }
  if (name === 'CONST - TikTok Pixel ID') {
    return {
      description: 'TikTok Ads pixel ID',
      where_to_find: 'TikTok Ads Manager → Assets → Events → Web Events → your pixel → Pixel ID',
      example: 'C4XXXXXXXXXXXXXXXXXX',
    };
  }
  if (name === 'CONST - LinkedIn Partner ID') {
    return {
      description: 'LinkedIn Insight Tag partner ID',
      where_to_find: 'LinkedIn Campaign Manager → Account Assets → Insight Tag → Partner ID',
      example: '1234567',
    };
  }
  if (name.startsWith('CONST - ')) {
    const label = name.replace('CONST - ', '');
    return {
      description: label,
      where_to_find: 'Your platform account settings',
      example: 'REPLACE_WITH_VALUE',
    };
  }
  return {
    description: name,
    where_to_find: 'Your platform account settings',
    example: 'REPLACE_WITH_VALUE',
  };
}

/**
 * Derive the placeholder table from the container's CONST variables.
 *
 * - Only includes variables whose current value still looks like a placeholder
 * - Only includes Meta/TikTok/LinkedIn variables when the platform is selected
 * - Rows are sorted: GA4 first, Google Ads ID, conversion labels, then others
 */
export function derivePlaceholderTable(
  variables: GTMVariableDef[],
  selectedPlatforms: string[],
): PlaceholderRow[] {
  const platformSet = new Set(selectedPlatforms);
  const rows: PlaceholderRow[] = [];

  // Filter to CONST variables with placeholder values
  const constVars = variables.filter(v => {
    if (v.type !== 'c') return false;
    const valParam = v.parameter.find(p => p.key === 'value');
    return isPlaceholderValue(valParam?.value);
  });

  for (const v of constVars) {
    // Guard: skip Meta Pixel ID if Meta not selected
    if (v.name === 'CONST - Meta Pixel ID' && !platformSet.has('meta')) continue;
    // Guard: skip TikTok Pixel ID if TikTok not selected
    if (v.name === 'CONST - TikTok Pixel ID' && !platformSet.has('tiktok')) continue;
    // Guard: skip LinkedIn Partner ID if LinkedIn not selected
    if (v.name === 'CONST - LinkedIn Partner ID' && !platformSet.has('linkedin')) continue;
    // Guard: skip GAds variables if google_ads not selected
    if (
      (v.name === 'CONST - Google Ads Conversion ID' ||
        v.name.startsWith('CONST - GAds Conversion Label -')) &&
      !platformSet.has('google_ads')
    ) continue;
    // Guard: skip GA4 ID if GA4 not selected
    if (v.name === 'CONST - GA4 Measurement ID' && !platformSet.has('ga4')) continue;

    const doc = docForVariable(v.name);
    rows.push({
      variable_name: v.name,
      description: doc.description,
      where_to_find: doc.where_to_find,
      example: doc.example,
    });
  }

  // Sort: GA4 first, Google Ads ID, conversion labels alphabetically, then rest
  rows.sort((a, b) => {
    const rank = (name: string) => {
      if (name === 'CONST - GA4 Measurement ID') return 0;
      if (name === 'CONST - Google Ads Conversion ID') return 1;
      if (name.startsWith('CONST - GAds Conversion Label -')) return 2;
      if (name === 'CONST - Meta Pixel ID') return 3;
      if (name === 'CONST - TikTok Pixel ID') return 4;
      if (name === 'CONST - LinkedIn Partner ID') return 5;
      return 6;
    };
    const ra = rank(a.variable_name);
    const rb = rank(b.variable_name);
    if (ra !== rb) return ra - rb;
    return a.variable_name.localeCompare(b.variable_name);
  });

  return rows;
}

// ── Metadata block ────────────────────────────────────────────────────────────

/**
 * Render the implementation guide metadata block (summary stats).
 * All counts are derived from the IR and the rendered container — never hardcoded.
 */
export function renderMetadataBlock(
  ir: AtlasIR,
  container: GTMContainerJSON,
): {
  totalEvents: number;
  conversionCount: number;
  engagementCount: number;
  platformCount: number;
  tagCount: number;
  variableCount: number;
  placeholderRows: PlaceholderRow[];
} {
  const totalEvents = ir.events.length;
  const conversionCount = ir.events.filter(e => e.is_conversion).length;
  const engagementCount = totalEvents - conversionCount;
  const platformCount = ir.platforms.length;

  const cv = container.containerVersion;
  const tagCount = cv.tag.length;
  const variableCount = cv.variable.length;
  const placeholderRows = derivePlaceholderTable(cv.variable, ir.platforms);

  return {
    totalEvents,
    conversionCount,
    engagementCount,
    platformCount,
    tagCount,
    variableCount,
    placeholderRows,
  };
}
