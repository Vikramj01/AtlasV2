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
 * Sprint 4 (C2 execution) migrated the GA4 config tag from the legacy
 * `gaawc` type to the real `googtag` (unified Google tag) type — the field
 * rename that's actually well-documented (`measurementId` → `tagId`) is
 * applied; everything else (`sendPageView`, `enableSendToServerContainer`,
 * `serverContainerUrl`, `linked_domains`) keeps its `gaawc`-era parameter
 * key name. **This is a best-effort reconstruction, not verified against a
 * live GTM export** — developers.google.com/support.google.com are network-
 * blocked in this sandbox, and the two files this session was given as
 * candidate ground truth (`atlas-gtm-v1_1.json`, a Planning-generated
 * container) turned out to be Atlas's own pre-migration `gaawc` output, not
 * a real export containing a `googtag` tag. Re-verify every parameter name
 * below against an actual GTM export with a live Google tag configured
 * before this generates a container for a real client. `gaawc` itself is
 * NOT removed from the codebase — every read/audit path (tagConfiguration.ts,
 * gtmSchemaValidator.ts, consent.renderer.ts, generation.validator.ts,
 * implementationDrift.ts) still recognises it, since Atlas must keep
 * auditing existing clients' legacy containers correctly even though it no
 * longer generates that shape itself.
 *
 * `GoogleTagDestinations` is the explicit, typed interface Sprint 6 grows
 * when the real `googtag` tag gains per-destination config blocks (User-
 * Provided Data, additional accounts, etc.) — callers pass only the IDs
 * they actually have; nothing here invents a placeholder ID.
 */
import type { GTMTagDef, GTMTriggerDef, GTMVariableDef, GTMParameter } from '../gtmContainerGenerator';
import { consentSettingsForTag } from './consent.renderer';
import { decideConversionLinker } from './linkerDecisionEngine';

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
  /**
   * Forward-looking hook for linkerDecisionEngine.ts's Floodlight input —
   * Atlas does not generate Floodlight (Campaign Manager) tags anywhere
   * today, so no caller currently sets this. Present so the decision engine
   * has a real field to read once Floodlight generation exists, rather than
   * a TODO comment nobody remembers to wire up.
   */
  floodlight?: { advertiserId: string };
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
      type: 'googtag',
      parameter: [
        tmpl('tagId', '{{CONST - GA4 Measurement ID}}'),
        bool('sendPageView', 'true'),
        bool('enableSendToServerContainer', options.serverContainerUrl ? 'true' : 'false'),
        ...(options.serverContainerUrl ? [tmpl('serverContainerUrl', options.serverContainerUrl)] : []),
        ...(secondaryDomains.length > 0 ? [list('linked_domains', secondaryDomains)] : []),
      ],
      firingTriggerId: [options.allPagesTriggerId],
      tagFiringOption: 'oncePerEvent',
      folderId: options.folderId,
      consentSettings: consentSettingsForTag('googtag', ''),
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
    // The CONST variable is created unconditionally — renderGoogleAdsConversionTag()
    // (gtm.renderer.ts) references '{{CONST - Google Ads Conversion ID}}' on every
    // per-event `awct` conversion tag regardless of whether a standalone Conversion
    // Linker tag is emitted below. Only the linker TAG itself is conditional.
    variables.push({
      ...stub(),
      variableId: options.nextVarId(),
      name: 'CONST - Google Ads Conversion ID',
      type: 'c',
      parameter: [tmpl('value', destinations.googleAds.conversionId)],
      folderId: options.variableFolderId,
    });

    const linkerDecision = decideConversionLinker({
      hasGoogleTagFiring: Boolean(destinations.ga4),
      hasFloodlight: Boolean(destinations.floodlight),
      crossDomainNeeded: secondaryDomains.length > 0,
      serverContainerConfigured: Boolean(options.serverContainerUrl),
    });

    if (linkerDecision.emitConversionLinker) {
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
        notes: linkerDecision.reason,
      });
    }
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
