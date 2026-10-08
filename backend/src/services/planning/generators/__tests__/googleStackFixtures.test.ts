/**
 * Google Stack Alignment — Sprint 2: golden GTM fixtures
 *
 * Safety net for Sprints 3-6 (canonical Google tag architecture, gaawc→googtag
 * migration, linker decision engine, User-Provided Data/SHA-256 removal). Per
 * docs/atlas-sprint-plan-google-stack-alignment.md, these fixtures were
 * originally captured against PRE-Sprint-4 generator output (the generator
 * emitted legacy `gaawc`/`gclidw`, not `googtag`) so Sprint 4 would have a
 * real before/after diff instead of discovering drift after the fact.
 *
 * Sprint 4 has since landed: the assertions below were updated in the same
 * change that migrated the generator (see `googleTagArchitecture.ts`) — that
 * diff itself IS the documented before/after record this suite exists to
 * enable. `gaawc` is preserved as a legacy READ-side type (every audit/
 * consent/validator path that recognises tags still accepts it) — see
 * Scenario F below and `tagConfiguration.crossDomain.test.ts` for that.
 *
 * Deliberately structural, not raw snapshots (that's the gap the sprint plan
 * calls out in C9): each scenario asserts exact tag TYPE, exact parameter
 * KEYS/VALUES, and firing shape (which trigger, resolved by type/name rather
 * than a hardcoded numeric ID, since a later sprint changing generation order
 * would just renumber IDs without changing shape). Any future change to a
 * tag's type, a parameter's name, or what a tag fires on breaks one of these
 * assertions loudly.
 *
 * One fixture (see `realGtmExport.fixture.json`) is a hand-built container
 * shaped like a genuine GTM Admin API export — used for the `googtag` +
 * legacy-`gaawc`-coexisting "mid-migration" architectural scenario a real
 * client's own container can be in even after Atlas's generator has moved
 * on. Its schema (exportFormatVersion, containerVersion, tag/trigger/
 * variable field names and the specific tag `type` codes used) is built from
 * this codebase's own established knowledge of the GTM export format (see
 * gtmContainerGenerator.ts's GTMContainerJSON type and the real `gaawc`/
 * `gclidw`/`awct`/`flc` type codes already load-bearing elsewhere in this
 * repo), not a fresh live pull — developers.google.com/support.google.com
 * are network-blocked in this sandbox (same caveat as the sprint plan's own
 * verification note, and as `googleTagArchitecture.ts`'s own header comment
 * on the `googtag` schema specifically). Re-verify against an actual
 * exported container before treating its exact field shape as ground truth
 * for Sprint 5/6 work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { generateGTMContainer, sanitiseHoneypotSelector } from '../gtmContainerGenerator';
import type { GTMTagDef, GTMParameter, GTMContainerJSON } from '../gtmContainerGenerator';
import { validateGTMContainer } from '../gtmSchemaValidator';
import { classifyGoogleTag } from '../../../google/googleTagClassifier';
import type { PlanningRecommendation, SuggestedParam, PlanningSession } from '@/types/planning';

// ── Fixture helpers (mirrors nlcs.integration.test.ts's factory pattern) ──────

function makeParam(key: string, example = 'example'): SuggestedParam {
  return { param_key: key, param_label: key, source: 'developer_provided', source_detail: '', example_value: example };
}

function makeRec(
  id: string,
  pageId: string,
  eventName: string,
  actionType: string,
  required: string[],
  optional: string[] = [],
  platforms: string[] = ['ga4'],
): PlanningRecommendation {
  return {
    id,
    page_id: pageId,
    action_type: actionType,
    event_name: eventName,
    element_selector: actionType === 'page_view' ? undefined : `#${eventName}`,
    element_type: actionType === 'page_view' ? 'track_page_view' : 'track_click',
    required_params: required.map((k) => makeParam(k)),
    optional_params: optional.map((k) => makeParam(k)),
    confidence_score: 1,
    business_justification: `Track ${eventName}`,
    affected_platforms: platforms,
    source: 'ai',
  };
}

function makeSession(
  businessType: PlanningSession['business_type'],
  platforms: string[],
  secondaryDomains: string[] = [],
): Pick<PlanningSession, 'business_type' | 'selected_platforms' | 'secondary_domains'> {
  return {
    business_type: businessType,
    selected_platforms: platforms,
    secondary_domains: secondaryDomains,
  };
}

// ── Structural inspection helpers ─────────────────────────────────────────────

/** Flattens a tag/variable's parameter list into a plain key→value object.
 *  LIST params resolve to an array of their TEMPLATE item values so domain
 *  lists (cross-domain linking) can be asserted precisely; MAP entries are
 *  skipped here (event parameter maps are asserted separately per-scenario). */
function flattenParams(params: GTMParameter[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    if (!p.key) continue;
    if (p.type === 'LIST' && p.list) {
      out[p.key] = p.list.map((item) => item.value);
    } else if (p.value !== undefined) {
      out[p.key] = p.value;
    }
  }
  return out;
}

function findTagByName(container: GTMContainerJSON, name: string): GTMTagDef {
  const tag = container.containerVersion.tag.find((t) => t.name === name);
  if (!tag) {
    throw new Error(`Fixture assertion failure: expected a tag named "${name}" — none found. Tag names present: ${container.containerVersion.tag.map((t) => t.name).join(', ')}`);
  }
  return tag;
}

/** Resolves a tag's firingTriggerId array to the actual trigger definitions,
 *  so firing-shape assertions check trigger TYPE/behaviour rather than a
 *  fragile literal numeric ID. */
function resolveFiringTriggers(container: GTMContainerJSON, tag: GTMTagDef) {
  return tag.firingTriggerId.map((id) => {
    const trigger = container.containerVersion.trigger.find((t) => t.triggerId === id);
    if (!trigger) throw new Error(`Tag "${tag.name}" fires on unresolved trigger ID "${id}"`);
    return trigger;
  });
}

// ── Scenario A: legacy single-domain baseline (current gaawc/gclidw shape) ───
// This is what EVERY Atlas-generated container looks like today — there is no
// "legacy" vs "current" distinction yet from Atlas's own generator until
// Sprint 4 ships googtag. This scenario is what that migration must preserve
// or deliberately change.

describe('Scenario: single-domain baseline (GA4 + Google Ads, no cross-domain, no sGTM)', () => {
  const session = makeSession('lead_gen', ['ga4', 'google_ads']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
    makeRec('r2', 'p2', 'contact_form_submit', 'form_submit', ['form_id'], [], ['ga4', 'google_ads']),
    makeRec('r3', 'p2', 'contact_form_submit', 'generate_lead', ['form_id'], [], ['ga4', 'google_ads']),
  ];
  const container = generateGTMContainer(recs, session);

  it('produces a structurally valid container', () => {
    const result = validateGTMContainer(container);
    expect(result.errors).toEqual([]);
  });

  it('GA4 Config tag is type "googtag" (Sprint 4 migration) with no server-container or cross-domain params', () => {
    const tag = findTagByName(container, 'GA4 - Config');
    expect(tag.type).toBe('googtag');
    const params = flattenParams(tag.parameter);
    expect(params).toEqual({
      tagId: '{{CONST - GA4 Measurement ID}}',
      sendPageView: 'true',
      enableSendToServerContainer: 'false',
    });
    expect(params).not.toHaveProperty('serverContainerUrl');
    expect(params).not.toHaveProperty('linked_domains');
    expect(params).not.toHaveProperty('measurementId');
  });

  it('GA4 Config fires on a PAGEVIEW-type "All Pages" trigger', () => {
    const tag = findTagByName(container, 'GA4 - Config');
    const triggers = resolveFiringTriggers(container, tag);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe('PAGEVIEW');
    expect(triggers[0].name).toBe('All Pages');
  });

  it('Google Tag Topology Sprint 2: a separate sitewide Ads googtag (AW- ID) exists alongside the GA4 googtag, on the same trigger', () => {
    const ads = findTagByName(container, 'Google Tag - Google Ads');
    expect(ads.type).toBe('googtag');
    expect(flattenParams(ads.parameter)).toEqual({ tagId: '{{CONST - Google Ads Conversion ID}}' });
    const ga4 = findTagByName(container, 'GA4 - Config');
    expect(ads.firingTriggerId).toEqual(ga4.firingTriggerId);
    // One Google tag per destination: the GA4 tag must not carry the AW- ID.
    expect(JSON.stringify(ga4.parameter)).not.toContain('Google Ads Conversion ID');
  });

  it('Sprint 5 (C4, rebased in Topology Sprint 2): no standalone Conversion Linker — the Ads googtag covers single-domain click-ID capture', () => {
    const names = container.containerVersion.tag.map((t) => t.name);
    expect(names).not.toContain('Google Ads - Conversion Linker');
    expect(container.containerVersion.tag.some((t) => t.type === 'gclidw')).toBe(false);
  });

  it('CONST - Google Ads Conversion ID variable still exists even with no Conversion Linker tag (awct tags depend on it)', () => {
    const variable = container.containerVersion.variable.find((v) => v.name === 'CONST - Google Ads Conversion ID');
    expect(variable).toBeDefined();
  });

  it('Google Ads conversion tag ("awct") always carries enhanced-conversions params', () => {
    const tag = findTagByName(container, 'Google Ads - contact_form_submit Conversion');
    expect(tag.type).toBe('awct');
    const params = flattenParams(tag.parameter);
    expect(params.enhancedConversionsEnabled).toBe('true');
    expect(params.userDataEmail).toBe('{{DLV - user_data.email}}');
    expect(params.userDataPhoneNumber).toBe('{{DLV - user_data.phone_number}}');
    expect(params.conversionId).toBe('{{CONST - Google Ads Conversion ID}}');
    expect(typeof params.conversionLabel).toBe('string');
    expect(params.conversionLabel).toMatch(/^\{\{CONST - GAds Conversion Label - contact_form_submit\}\}$/);
  });
});

// ── Scenario B: cross-domain linking ──────────────────────────────────────────

describe('Scenario: cross-domain (secondary_domains configured)', () => {
  const session = makeSession('lead_gen', ['ga4', 'google_ads'], ['app.example.com', 'checkout.example.com']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
    makeRec('r2', 'p2', 'generate_lead', 'generate_lead', ['form_id'], [], ['ga4', 'google_ads']),
  ];
  const container = generateGTMContainer(recs, session);

  it('GA4 Config carries linked_domains matching secondary_domains exactly', () => {
    const tag = findTagByName(container, 'GA4 - Config');
    const params = flattenParams(tag.parameter);
    expect(params.linked_domains).toEqual(['app.example.com', 'checkout.example.com']);
  });

  it('keeps both the Ads googtag and the Conversion Linker', () => {
    expect(findTagByName(container, 'Google Tag - Google Ads').type).toBe('googtag');
    expect(findTagByName(container, 'Google Ads - Conversion Linker').type).toBe('gclidw');
  });

  it('Conversion Linker enables cross-domain linking with the same domain list', () => {
    const tag = findTagByName(container, 'Google Ads - Conversion Linker');
    const params = flattenParams(tag.parameter);
    expect(params.enableCrossDomainLinking).toBe('true');
    expect(params.autoLinkDomains).toBe('true');
    expect(params.domains).toEqual(['app.example.com', 'checkout.example.com']);
  });
});

// ── Scenario C: sGTM-enabled (verified server-container endpoint on file) ────

describe('Scenario: sGTM-enabled (platformIds.server_container_url set)', () => {
  const session = makeSession('lead_gen', ['ga4', 'google_ads']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
  ];
  const container = generateGTMContainer(recs, session, {
    server_container_url: 'https://sgtm.example.com',
  });

  it('routes GA4 Config through the verified sGTM endpoint', () => {
    const tag = findTagByName(container, 'GA4 - Config');
    const params = flattenParams(tag.parameter);
    expect(params.enableSendToServerContainer).toBe('true');
    expect(params.serverContainerUrl).toBe('https://sgtm.example.com');
  });

  it('Topology Sprint 2: emits the Ads googtag and keeps the Conversion Linker', () => {
    expect(findTagByName(container, 'Google Tag - Google Ads').type).toBe('googtag');
    expect(container.containerVersion.tag.some((t) => t.name === 'Google Ads - Conversion Linker')).toBe(true);
  });

  it('Sprint 5 (C4): still emits the Conversion Linker despite a single-domain googtag being present — sGTM routing needs its own client-side linker', () => {
    const tag = findTagByName(container, 'Google Ads - Conversion Linker');
    expect(tag.type).toBe('gclidw');
    expect(tag.notes).toContain('Server-side GTM routing');
  });
});

// ── Scenario C2: Ads-only (Google Ads selected, GA4 not selected) ────────────
// Topology Sprint 2: the Ads destination gets its OWN sitewide Google tag, so
// the single-domain Conversion Linker is skipped (Google's guidance) — before
// this sprint a GA4-less client got a linker only because no googtag existed.

describe('Scenario: Ads-only (Google Ads selected, GA4 not selected)', () => {
  const session = makeSession('lead_gen', ['google_ads']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'generate_lead', 'generate_lead', ['form_id'], [], ['google_ads']),
  ];
  const container = generateGTMContainer(recs, session);

  it('emits an Ads googtag, no GA4 Config and no Conversion Linker (single-domain)', () => {
    const names = container.containerVersion.tag.map((t) => t.name);
    expect(names).not.toContain('GA4 - Config');
    expect(names).toContain('Google Tag - Google Ads');
    expect(names).not.toContain('Google Ads - Conversion Linker');
  });
});

// ── Scenario C3: GA4-only (no Google Ads destination) ────────────────────────

describe('Scenario: GA4-only (GA4 selected, no Google Ads)', () => {
  const session = makeSession('lead_gen', ['ga4']);
  const recs: PlanningRecommendation[] = [makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4'])];
  const container = generateGTMContainer(recs, session);

  it('emits no Ads googtag and no Conversion Linker', () => {
    const names = container.containerVersion.tag.map((t) => t.name);
    expect(names).toContain('GA4 - Config');
    expect(names).not.toContain('Google Tag - Google Ads');
    expect(names).not.toContain('Google Ads - Conversion Linker');
  });
});

// ── Scenario D: enhanced conversions with full identity params ───────────────
// Sprint 6 (C6/C7): the per-tag `awct` Enhanced Conversions params now cover
// email/phone/first_name/last_name/postal_code/country (the conservative,
// already-proven per-tag pattern — not the site-level "User-Provided Data"
// architecture the sprint plan's literal wording describes; see
// gtm.renderer.ts's header comment for why), and the unhashed CJS - SHA256
// Hash stub is gone entirely.

describe('Scenario: enhanced conversions (ecommerce purchase, email+phone captured)', () => {
  const session = makeSession('ecommerce', ['ga4', 'google_ads']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'purchase', 'purchase', ['transaction_id', 'value', 'currency'], ['coupon'], ['ga4', 'google_ads']),
  ];
  const container = generateGTMContainer(recs, session);

  it('Google Ads purchase conversion tag reads value/currency/orderId from the ecommerce dataLayer namespace', () => {
    const tag = findTagByName(container, 'Google Ads - purchase Conversion');
    const params = flattenParams(tag.parameter);
    expect(params.conversionValue).toBe('{{DLV - ecommerce.value}}');
    expect(params.currencyCode).toBe('{{DLV - ecommerce.currency}}');
    expect(params.orderId).toBe('{{DLV - ecommerce.transaction_id}}');
    expect(params.enhancedConversionsEnabled).toBe('true');
    expect(params.userDataEmail).toBe('{{DLV - user_data.email}}');
    expect(params.userDataPhoneNumber).toBe('{{DLV - user_data.phone_number}}');
  });

  it('Sprint 6 (C6): also maps first_name/last_name/postal_code/country beyond email/phone', () => {
    const tag = findTagByName(container, 'Google Ads - purchase Conversion');
    const params = flattenParams(tag.parameter);
    expect(params.userDataFirstName).toBe('{{DLV - user_data.first_name}}');
    expect(params.userDataLastName).toBe('{{DLV - user_data.last_name}}');
    expect(params.userDataPostalCode).toBe('{{DLV - user_data.postal_code}}');
    expect(params.userDataCountry).toBe('{{DLV - user_data.country}}');
  });

  it('Sprint 6 (C7): the unhashed CJS - SHA256 Hash stub no longer ships', () => {
    const variable = container.containerVersion.variable.find((v) => v.name === 'CJS - SHA256 Hash');
    expect(variable).toBeUndefined();
  });
});

// ── Scenario E: full multi-platform stack ─────────────────────────────────────

describe('Scenario: full multi-platform stack (GA4 + Google Ads + Meta + TikTok + LinkedIn)', () => {
  const session = makeSession('ecommerce', ['ga4', 'google_ads', 'meta', 'tiktok', 'linkedin']);
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'page_view', 'page_view', [], [], ['ga4']),
    makeRec('r2', 'p2', 'add_to_cart', 'add_to_cart', ['item_id', 'item_name', 'quantity'], [], ['ga4', 'meta', 'tiktok']),
    makeRec('r3', 'p3', 'purchase', 'purchase', ['transaction_id', 'value', 'currency'], [], ['ga4', 'google_ads', 'meta', 'tiktok', 'linkedin']),
  ];
  const container = generateGTMContainer(recs, session);

  it('emits exactly one tag per platform for the purchase event, each with the expected type', () => {
    const gads = findTagByName(container, 'Google Ads - purchase Conversion');
    const meta = findTagByName(container, 'Meta - purchase');
    const tiktok = findTagByName(container, 'TikTok - purchase');
    const linkedin = findTagByName(container, 'LinkedIn - purchase');

    expect(gads.type).toBe('awct');
    expect(meta.type).toBe('html');
    expect(tiktok.type).toBe('html');
    expect(linkedin.type).toBe('html');

    // Meta/TikTok/LinkedIn are rendered as inline <script> HTML tags today —
    // any future migration to native GTM tag types (Sprint 3+ scope) should
    // update this assertion deliberately.
    const metaHtml = flattenParams(meta.parameter).html as string;
    expect(metaHtml).toContain("fbq('track', 'Purchase'");
    const tiktokHtml = flattenParams(tiktok.parameter).html as string;
    expect(tiktokHtml).toContain("ttq.track('CompletePayment'");
    const linkedinHtml = flattenParams(linkedin.parameter).html as string;
    expect(linkedinHtml).toContain("lintrk('track'");
  });

  it('every platform tag for the same event fires on the same trigger set', () => {
    const gads = findTagByName(container, 'Google Ads - purchase Conversion');
    const meta = findTagByName(container, 'Meta - purchase');
    expect(new Set(gads.firingTriggerId)).toEqual(new Set(meta.firingTriggerId));
  });

  it('passes the schema validator with no errors across the full stack', () => {
    const result = validateGTMContainer(container);
    expect(result.errors).toEqual([]);
  });
});

// ── Scenario F: real GTM export — googtag + mid-migration (gaawc/googtag coexist) ──
// The current generator cannot produce this shape (Atlas has never emitted
// googtag before Sprint 4) — this fixture instead represents a real client's
// existing container mid-way through Google's own gtag.js migration guidance,
// which Sprint 4 must be able to read/audit correctly even as Atlas's own
// generation output changes (sprint plan Sprint 4 acceptance: "legacy
// containers still audit correctly").

describe('Fixture: real GTM export shape — googtag + legacy gaawc coexisting', () => {
  const fixturePath = join(__dirname, 'fixtures', 'realGtmExport.mixedMigration.json');
  const raw = readFileSync(fixturePath, 'utf-8');
  const exported = JSON.parse(raw) as GTMContainerJSON;

  it('is schema-valid per the existing GTM validator', () => {
    const result = validateGTMContainer(exported);
    expect(result.errors).toEqual([]);
  });

  it('contains both a legacy gaawc tag and a googtag tag (the mid-migration state)', () => {
    const types = exported.containerVersion.tag.map((t) => t.type);
    expect(types).toContain('gaawc');
    expect(types).toContain('googtag');
  });

  it('the googtag tag uses "tagId" as its config-ID parameter key (not "measurementId")', () => {
    const googTag = exported.containerVersion.tag.find((t) => t.type === 'googtag');
    expect(googTag).toBeDefined();
    const params = flattenParams(googTag!.parameter);
    expect(params).toHaveProperty('tagId');
    expect(params).not.toHaveProperty('measurementId');
  });

  it('the legacy Conversion Linker in this export is the real "flc" Floodlight Counter type', () => {
    // Sprint plan Correction 6: composableOutputGenerator.ts wrongly reuses
    // 'flc' (Floodlight Counter — a DoubleClick/Campaign Manager tag type,
    // not a Google Ads conversion linker) for a tag it names "Conversion
    // Linker". This fixture asserts what 'flc' actually looks like in a real
    // export, so that broken-output claim stays checkable against ground
    // truth rather than assumed.
    const flcTag = exported.containerVersion.tag.find((t) => t.type === 'flc');
    expect(flcTag).toBeDefined();
    expect(flcTag!.name.toLowerCase()).not.toContain('conversion linker');
    const params = flattenParams(flcTag!.parameter);
    expect(params).toHaveProperty('advertiserId');
    expect(params).toHaveProperty('groupTag');
    expect(params).toHaveProperty('activityTag');
    // The real Google Ads conversion linker tag type is 'gclidw' — distinct
    // from 'flc'. A generator emitting 'flc' for a "Conversion Linker" tag
    // (as composableOutputGenerator.ts does today) does not produce this shape.
    expect(params).not.toHaveProperty('enableCrossDomainLinking');
  });
});

// ── Topology acceptance 4: every Ads container has a sitewide googtag classified google_ads ──

describe('Every generated container with a Google Ads destination has a classified Ads Google tag', () => {
  const cases: Array<[string, string[], string[]]> = [
    ['GA4 + Ads', ['ga4', 'google_ads'], []],
    ['Ads-only', ['google_ads'], []],
    ['cross-domain', ['ga4', 'google_ads'], ['app.example.com']],
  ];
  it.each(cases)('%s', (_label, platforms, domains) => {
    const container = generateGTMContainer(
      [makeRec('r1', 'p1', 'generate_lead', 'generate_lead', ['form_id'], [], platforms)],
      makeSession('lead_gen', platforms, domains),
    );
    const { tag: tags, variable: variables } = container.containerVersion;
    const adsTags = tags.filter(
      (t) => t.type === 'googtag' && classifyGoogleTag(t, { variables }).kind === 'google_ads',
    );
    expect(adsTags).toHaveLength(1);
    const trigger = container.containerVersion.trigger.find((tr) => tr.triggerId === adsTags[0].firingTriggerId[0]);
    expect(trigger?.type).toBe('PAGEVIEW');
  });
});

// ── Scenario G: junk gate capture (GA4 Admin / L11 / Junk Gate PRD §C.5b, C3) ─
// The Signal Tag beacons `ms_to_submit` (and, only when a honeypot selector is mapped, a boolean
// `honeypot_filled`) so JC_SUBMIT_TOO_FAST / JC_HONEYPOT_FILLED have an input. The beacon is the
// ONLY browser path into the gate, so these fixtures pin the contract on both ends.

describe('Scenario: junk gate capture (Atlas Signal Tag + Form Interaction Timer)', () => {
  const recs: PlanningRecommendation[] = [
    makeRec('r1', 'p1', 'generate_lead', 'form_submit', [], [], ['ga4', 'meta']),
  ];
  const withMeta = generateGTMContainer(recs, makeSession('lead_gen', ['ga4', 'meta']));
  const scriptOf = (c: GTMContainerJSON, name: string) => flattenParams(findTagByName(c, name).parameter).html as string;

  it('emits a Form Interaction Timer on All Pages whenever the Signal Tag is emitted', () => {
    const timer = findTagByName(withMeta, 'Atlas - Form Interaction Timer');
    expect(timer.type).toBe('html');
    const triggers = resolveFiringTriggers(withMeta, timer);
    expect(triggers.map((t) => t.type)).toEqual(['PAGEVIEW']);
    const html = scriptOf(withMeta, 'Atlas - Form Interaction Timer');
    expect(html).toContain("addEventListener('focusin'");
    expect(html).toContain("sessionStorage.setItem('atlas_first_interaction'");
  });

  it('the timer stores one timestamp and never reads a field value; it is ads-consent gated like the Signal Tag', () => {
    const html = scriptOf(withMeta, 'Atlas - Form Interaction Timer');
    expect(html).not.toMatch(/\.value\b/);
    expect(html).toContain('adsConsentGranted()');
    expect(findTagByName(withMeta, 'Atlas - Form Interaction Timer').consentSettings)
      .toEqual(findTagByName(withMeta, 'Atlas - Signal Tag').consentSettings);
  });

  it('the Signal Tag beacons ms_to_submit from the same storage key and clears it', () => {
    const html = scriptOf(withMeta, 'Atlas - Signal Tag');
    expect(html).toContain("sessionStorage.getItem('atlas_first_interaction')");
    expect(html).toContain("sessionStorage.removeItem('atlas_first_interaction')");
    expect(html).toContain('payload.ms_to_submit = junk.ms_to_submit');
  });

  it('the timer WRITES the exact storage key the Signal Tag READS and CLEARS (they cannot drift apart)', () => {
    const key = (html: string, fn: string) => new RegExp(`sessionStorage\\.${fn}\\('([^']+)'`).exec(html)?.[1];
    const timer = scriptOf(withMeta, 'Atlas - Form Interaction Timer');
    const signal = scriptOf(withMeta, 'Atlas - Signal Tag');
    const written = key(timer, 'setItem');
    expect(written).toBeTruthy();
    expect(key(timer, 'getItem')).toBe(written);
    expect(key(signal, 'getItem')).toBe(written);
    expect(key(signal, 'removeItem')).toBe(written);
  });

  it('with no honeypot selector the beacon has no honeypot logic at all (Atlas never injects a field)', () => {
    const html = scriptOf(withMeta, 'Atlas - Signal Tag');
    expect(html).not.toContain('querySelector');
    expect(html).toContain('payload.honeypot_filled = junk.honeypot_filled'); // guarded: only set when computed
  });

  it('a mapped honeypot selector yields a boolean only, JSON-encoded into the script', () => {
    const c = generateGTMContainer(recs, makeSession('lead_gen', ['ga4', 'meta']), { junk_honeypot_selector: 'input[name="website"]' });
    const html = scriptOf(c, 'Atlas - Signal Tag');
    expect(html).toContain('document.querySelector("input[name=\\"website\\"]")');
    expect(html).toContain("junk.honeypot_filled = String(hp.value || '').trim() !== ''");
    expect(html).not.toMatch(/payload\.honeypot_value/);
  });

  it('an unsafe selector is dropped rather than embedded', () => {
    const c = generateGTMContainer(recs, makeSession('lead_gen', ['ga4', 'meta']), { junk_honeypot_selector: "x');alert(1);//" });
    expect(scriptOf(c, 'Atlas - Signal Tag')).not.toContain('alert(1)');
    expect(scriptOf(c, 'Atlas - Signal Tag')).not.toContain('querySelector');
  });

  it('sanitiseHoneypotSelector accepts ordinary selectors and rejects script-breaking input', () => {
    for (const ok of ['input[name="website"]', '#hp_field', '.hp-trap', 'form input[name=url_confirm]']) expect(sanitiseHoneypotSelector(ok)).toBe(ok);
    for (const bad of ["x');alert(1);//", 'a`b', 'a;b', '</script>', '', undefined, 'x'.repeat(101)]) expect(sanitiseHoneypotSelector(bad as string | undefined)).toBeNull();
  });

  it('no Meta destination → no Signal Tag and no timer', () => {
    const c = generateGTMContainer(recs, makeSession('lead_gen', ['ga4']));
    expect(c.containerVersion.tag.some((t) => t.name === 'Atlas - Form Interaction Timer')).toBe(false);
    expect(c.containerVersion.tag.some((t) => t.name === 'Atlas - Signal Tag')).toBe(false);
  });

  it("the beacon's field names match what /api/capi/browser-event actually accepts (cross-module contract)", () => {
    const route = readFileSync(join(__dirname, '../../../../api/routes/capi.ts'), 'utf8');
    expect(route).toMatch(/ms_to_submit:\s+z\.number\(\)\.int\(\)/);
    expect(route).toMatch(/honeypot_filled:\s+z\.boolean\(\)/);
  });

  it('passes the schema validator', () => {
    expect(validateGTMContainer(withMeta).errors).toEqual([]);
  });
});
