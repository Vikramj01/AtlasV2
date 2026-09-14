/**
 * Canonical Google tag architecture — shared between the Planning path
 * (gtmContainerGenerator.ts) and the Composable Signals path
 * (composableOutputGenerator.ts). Single source of truth for the sitewide
 * Google configuration layer (GA4 Config + Google Ads Conversion Linker) so
 * the two paths can no longer structurally diverge the way Correction 6 of
 * docs/atlas-sprint-plan-google-stack-alignment.md found them to have:
 * Composable Signals was independently reinventing this layer and getting
 * it wrong (a Floodlight Counter type ('flc') mislabeled as "Conversion
 * Linker", 'googtag' used for what was actually a gaawc-shaped config, and
 * firingRuleId/lowercase parameter types that don't match any real GTM
 * field name).
 *
 * This still emits the legacy `gaawc` tag type — migrating the GA4 config
 * tag's actual TYPE to `googtag` is Sprint 4's job (C2 execution). This
 * sprint (C2 design, C3) only unifies WHO builds the sitewide Google tags,
 * not WHAT type they are, so today's output is byte-for-byte identical to
 * what gtmContainerGenerator.ts already produced before this extraction.
 *
 * `GoogleTagDestinations` is the explicit, typed interface Sprint 4/6 grow
 * when the real `googtag` tag gains per-destination config blocks (User-
 * Provided Data, additional accounts, etc.) — callers pass only the IDs
 * they actually have; nothing here invents a placeholder ID.
 */
import type { GTMTagDef, GTMTriggerDef, GTMVariableDef, GTMParameter } from '../gtmContainerGenerator';
import { consentSettingsForTag } from './consent.renderer';

// ── Primitive helpers (mirrors gtmContainerGenerator.ts / gtm.renderer.ts style) ──

function tmpl(key: string, value: string): GTMParameter {
  return { type: 'TEMPLATE', key, value };
}
function bool(key: string, value: string): GTMParameter {
  return { type: 'BOOLEAN', key, value };
}
function list(key: string, items: string[]): GTMParameter {
  return { type: 'LIST', key, list: items.map((v) => ({ type: 'TEMPLATE' as const, value: v })) };
}
function stub(accountId = '0', containerId = '0') {
  return { accountId, containerId, fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/' };
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface GoogleTagDestinations {
  ga4?: { measurementId: string };
  googleAds?: { conversionId: string };
}

export interface GoogleTagArchitectureOptions {
  /** Trigger ID of the caller's own "All Pages" PAGEVIEW trigger. */
  allPagesTriggerId: string;
  secondaryDomains?: string[];
  /** Verified sGTM transport URL — see GTMPlatformIds.server_container_url. */
  serverContainerUrl?: string;
  folderId?: string;
  variableFolderId?: string;
  nextTagId: () => string;
  nextVarId: () => string;
}

export interface GoogleTagArchitectureResult {
  tags: GTMTagDef[];
  variables: GTMVariableDef[];
}

/**
 * Builds the sitewide Google tag layer (GA4 Config + Google Ads Conversion
 * Linker, each with its CONST ID variable) for whichever destinations the
 * caller supplies. A destination is omitted entirely when not provided —
 * this function never fabricates a placeholder ID; that decision belongs to
 * the caller (Planning falls back to 'G-XXXXXXXXXX'-style placeholders when
 * a recommendation targets a platform with no ID on file yet; Composable
 * Signals should not, once real client platform IDs are always present).
 */
export function buildGoogleTagInfrastructure(
  destinations: GoogleTagDestinations,
  options: GoogleTagArchitectureOptions,
): GoogleTagArchitectureResult {
  const tags: GTMTagDef[] = [];
  const variables: GTMVariableDef[] = [];
  const secondaryDomains = options.secondaryDomains ?? [];

  if (destinations.ga4) {
    tags.push({
      ...stub(),
      tagId: options.nextTagId(),
      name: 'GA4 - Config',
      type: 'gaawc',
      parameter: [
        tmpl('measurementId', '{{CONST - GA4 Measurement ID}}'),
        bool('sendPageView', 'true'),
        bool('enableSendToServerContainer', options.serverContainerUrl ? 'true' : 'false'),
        ...(options.serverContainerUrl ? [tmpl('serverContainerUrl', options.serverContainerUrl)] : []),
        ...(secondaryDomains.length > 0 ? [list('linked_domains', secondaryDomains)] : []),
      ],
      firingTriggerId: [options.allPagesTriggerId],
      tagFiringOption: 'oncePerEvent',
      folderId: options.folderId,
      consentSettings: consentSettingsForTag('gaawc', ''),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    variables.push({
      ...stub(),
      variableId: options.nextVarId(),
      name: 'CONST - GA4 Measurement ID',
      type: 'c',
      parameter: [tmpl('value', destinations.ga4.measurementId)],
      folderId: options.variableFolderId,
    });
  }

  if (destinations.googleAds) {
    tags.push({
      ...stub(),
      tagId: options.nextTagId(),
      name: 'Google Ads - Conversion Linker',
      type: 'gclidw',
      parameter: [
        bool('enableCrossDomainLinking', secondaryDomains.length > 0 ? 'true' : 'false'),
        bool('autoLinkDomains', secondaryDomains.length > 0 ? 'true' : 'false'),
        bool('decorateFormsOption', 'false'),
        ...(secondaryDomains.length > 0 ? [list('domains', secondaryDomains)] : []),
      ],
      firingTriggerId: [options.allPagesTriggerId],
      tagFiringOption: 'oncePerEvent',
      folderId: options.folderId,
      consentSettings: consentSettingsForTag('gclidw', ''),
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    });

    variables.push({
      ...stub(),
      variableId: options.nextVarId(),
      name: 'CONST - Google Ads Conversion ID',
      type: 'c',
      parameter: [tmpl('value', destinations.googleAds.conversionId)],
      folderId: options.variableFolderId,
    });
  }

  return { tags, variables };
}

/** The real GTM built-in PAGEVIEW trigger every "fires on every page" tag needs. */
export function buildAllPagesTrigger(triggerId: string, folderId?: string): GTMTriggerDef {
  return {
    ...stub(),
    triggerId,
    name: 'All Pages',
    type: 'PAGEVIEW',
    folderId,
  };
}
