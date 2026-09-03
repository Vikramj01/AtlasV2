/**
 * Layer L5 — Event Firing (12 of 14 rules — see note on L5.8/L5.9 below).
 *
 * L1 asked "is the base tag present." This layer asks whether the actual
 * conversion events fire — on the right surface, exactly once, in the
 * right order, and nowhere they shouldn't. Reads AuditData.dataLayer/
 * networkRequests/steps_visited plus the Scan Input declared_conversions
 * (which page(s) the advertiser told Atlas are the real conversion
 * surfaces) and namingConvention (the org's Naming Conventions config,
 * reused as-is from services/signals/namingConvention.ts rather than
 * reimplementing event-name validation a second time).
 *
 * L5.8 ("fires on SPA route change") needs to correlate a client-side
 * navigation with the event it triggers — journeySimulator only ever
 * hard-navigates between steps (page.goto()), so there is no in-page
 * route change in this crawl to observe firing behavior against. Unlike
 * every other deferred rule in this rebuild, this one IS labeled
 * Detectable by: Crawl in the register — it's excluded here not because
 * the method is out of phase, but because journeySimulator doesn't yet
 * drive real in-page navigation (clicking through client-side routes
 * instead of reloading), which is what testing this honestly requires.
 * L5.9 ("fires on direct load of the conversion surface") is genuinely
 * Second-pass detectable — deferred like every other non-crawl method.
 * Neither is included in L5_RULES.
 */
import type { AuditData, ValidationResult, ValidationRule, RuleStatus, DataLayerEvent } from '@/types/audit';
import * as trackingSignals from '@/services/detection/trackingSignals';
import { validateEventName, DEFAULT_CONVENTION } from '@/services/signals/namingConvention';

function primaryConversionName(auditData: AuditData): string | undefined {
  return auditData.declared_conversions?.find((c) => c.kind === 'primary')?.name;
}

function secondaryConversionNames(auditData: AuditData): string[] {
  return (auditData.declared_conversions ?? []).filter((c) => c.kind === 'secondary').map((c) => c.name);
}

/** The last non-init step the crawl visited — the presumed conversion surface when nothing more specific is declared. */
function completionStep(auditData: AuditData): string | undefined {
  const steps = (auditData.steps_visited ?? []).filter((s) => s !== 'init');
  return steps[steps.length - 1];
}

function eventsNamed(auditData: AuditData, name: string): DataLayerEvent[] {
  return auditData.dataLayer.filter((e) => e.event === name);
}

// ── L5.1 — Primary conversion event fires ────────────────────────────────────

export const PRIMARY_CONVERSION_EVENT_FIRES: ValidationRule = {
  id: 'L5.1',
  rule_id: 'PRIMARY_CONVERSION_EVENT_FIRES',
  layer: 'event_firing',
  check: 'Primary conversion event fires',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);
    if (!name) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No primary conversion declared in Scan Inputs',
          expected: 'The declared primary conversion event is observed on its surface',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const fired = eventsNamed(auditData, name).length > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: fired ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: fired ? `"${name}" observed in dataLayer` : `"${name}" was never observed`,
        expected: `The declared primary conversion event ("${name}") fires — the entire feedback loop rests on it`,
        evidence: [`Declared primary conversion: ${name}`, `Observed: ${fired}`],
      },
    };
  },
};

// ── L5.2-5.5 — Per-platform conversion event fires ───────────────────────────

function makeConversionFiresRule(opts: {
  id: string;
  rule_id: string;
  check: string;
  platform_scope: ValidationRule['platform_scope'];
  detect: (requests: AuditData['networkRequests']) => trackingSignals.TagMatch;
  expected: string;
  noneFoundMessage: string;
}): ValidationRule {
  return {
    id: opts.id,
    rule_id: opts.rule_id,
    layer: 'event_firing',
    check: opts.check,
    severity: 'critical',
    applies_to: 'all',
    platform_scope: opts.platform_scope,
    detectable_by: 'crawl',
    owner: 'Frontend',
    requires: ['conversion_surface'],

    test(auditData: AuditData): ValidationResult {
      const match = opts.detect(auditData.networkRequests);
      const found = match.hitCount > 0;

      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: found ? 'pass' : 'fail',
        severity: this.severity,
        technical_details: {
          found: found ? `Conversion hit observed (${match.hitCount} time(s))` : opts.noneFoundMessage,
          expected: opts.expected,
          evidence: found ? match.urls : [opts.noneFoundMessage],
        },
      };
    },
  };
}

export const GOOGLE_ADS_CONVERSION_EVENT_FIRES = makeConversionFiresRule({
  id: 'L5.2',
  rule_id: 'GOOGLE_ADS_CONVERSION_EVENT_FIRES',
  check: 'Google Ads conversion event fires',
  platform_scope: ['google_ads'],
  detect: trackingSignals.detectGoogleAds,
  expected: 'A conversion hit reaches googleadservices.com or google.com/pagead — without it Smart Bidding has no training data',
  noneFoundMessage: 'No request to googleadservices.com/pagead/conversion or google.com/pagead/conversion detected',
});

export const META_CONVERSION_EVENT_FIRES = makeConversionFiresRule({
  id: 'L5.3',
  rule_id: 'META_CONVERSION_EVENT_FIRES',
  check: 'Meta conversion event fires',
  platform_scope: ['meta'],
  detect: trackingSignals.detectMetaConversionEvent,
  expected: 'A Meta conversion event (not just the base PageView pixel call) is observed',
  noneFoundMessage: 'No facebook.com/tr request carrying a tracked event (ev != PageView) detected',
});

export const TIKTOK_CONVERSION_EVENT_FIRES = makeConversionFiresRule({
  id: 'L5.4',
  rule_id: 'TIKTOK_CONVERSION_EVENT_FIRES',
  check: 'TikTok conversion event fires',
  platform_scope: ['tiktok'],
  detect: trackingSignals.detectTikTokConversionEvent,
  expected: 'A TikTok pixel conversion event (a POST to the tracking endpoint, not just the loader script) is observed',
  noneFoundMessage: 'No POST request to analytics.tiktok.com detected',
});

// GA4 isn't a DeclaredPlatform (Scan Inputs models ad platforms only) —
// platform_scope: 'any', same modeling call as L1.4/L4's GA4 rules.
export const GA4_CONVERSION_EVENT_FIRES: ValidationRule = {
  id: 'L5.5',
  rule_id: 'GA4_CONVERSION_EVENT_FIRES',
  layer: 'event_firing',
  check: 'GA4 conversion event fires',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);

    if (!name) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No primary conversion declared in Scan Inputs',
          expected: 'A GA4 event matching the declared conversion is observed',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const hits = auditData.networkRequests.filter(
      (r) => trackingSignals.detectGa4([r]).hitCount > 0 && trackingSignals.ga4RequestParam(r, 'en') === name,
    );
    const found = hits.length > 0;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: found ? 'pass' : 'fail',
      severity: this.severity,
      technical_details: {
        found: found ? `GA4 event "${name}" observed (${hits.length} time(s))` : `No GA4 hit with en="${name}" observed`,
        expected: 'GA4 is the cross-platform reference point — a GA4 event matching the declared conversion must be observed',
        evidence: found ? hits.map((r) => r.url) : [`No google-analytics.com/g/collect hit with en=${name}`],
      },
    };
  },
};

// ── L5.6 — Event fires exactly once ──────────────────────────────────────────

export const EVENT_FIRES_EXACTLY_ONCE: ValidationRule = {
  id: 'L5.6',
  rule_id: 'EVENT_FIRES_EXACTLY_ONCE',
  layer: 'event_firing',
  check: 'Event fires exactly once',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);
    if (!name) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No primary conversion declared in Scan Inputs',
          expected: 'No duplicate transmission of the same conversion on one page view',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const events = eventsNamed(auditData, name);
    if (events.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: `"${name}" was never observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)`,
          expected: 'No duplicate transmission of the same conversion on one page view',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const byStep = new Map<string, number>();
    for (const e of events) byStep.set(e.step, (byStep.get(e.step) ?? 0) + 1);
    const duplicated = [...byStep.entries()].filter(([, count]) => count > 1);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: duplicated.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: duplicated.length > 0
          ? `"${name}" fired more than once on the same page view: ${duplicated.map(([step, count]) => `${step} (${count}x)`).join(', ')}`
          : `"${name}" fired exactly once per page view`,
        expected: 'Double firing inflates counts and nobody notices, because the number goes up',
        evidence: [...byStep.entries()].map(([step, count]) => `${step}: ${count} fire(s)`),
      },
    };
  },
};

// ── L5.7 / L5.11 — Where the primary conversion fired vs where it should have ──
//
// Both read the same underlying observation (which non-completion steps
// the primary conversion fired on) from two angles: L5.7 asks whether it
// fired on the right trigger (completion, not intent), L5.11 asks whether
// it leaked onto pages that aren't conversion surfaces at all. A
// dataLayer-only crawl can't distinguish "fired on a click" from "fired on
// a false-positive page" any more precisely than "fired somewhere other
// than the completion step" — so both share this helper rather than
// pretending to a distinction the data doesn't support.

function nonCompletionFires(auditData: AuditData, name: string): { events: DataLayerEvent[]; completion: string | undefined } {
  const completion = completionStep(auditData);
  const events = eventsNamed(auditData, name).filter((e) => e.step !== completion);
  return { events, completion };
}

export const FIRES_ON_COMPLETION_NOT_ON_INTENT: ValidationRule = {
  id: 'L5.7',
  rule_id: 'FIRES_ON_COMPLETION_NOT_ON_INTENT',
  layer: 'event_firing',
  check: 'Fires on completion, not on intent',
  severity: 'critical',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);
    if (!name || eventsNamed(auditData, name).length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !name ? 'No primary conversion declared in Scan Inputs' : `"${name}" was never observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)`,
          expected: 'The trigger is the confirmed outcome, not a button click or form submit attempt',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const { events, completion } = nonCompletionFires(auditData, name);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: events.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: events.length > 0
          ? `"${name}" fired at ${[...new Set(events.map((e) => e.step))].join(', ')} — before the completion step ("${completion}")`
          : `"${name}" only fired at the completion step ("${completion}")`,
        expected: 'Firing on click/submit counts abandoned and failed attempts as conversions',
        evidence: [`Completion step: ${completion ?? 'unknown'}`, `Fired at: ${[...new Set(eventsNamed(auditData, name).map((e) => e.step))].join(', ')}`],
      },
    };
  },
};

export const NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES: ValidationRule = {
  id: 'L5.11',
  rule_id: 'NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES',
  layer: 'event_firing',
  check: 'No conversion fires on non-conversion pages',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);
    if (!name || eventsNamed(auditData, name).length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !name ? 'No primary conversion declared in Scan Inputs' : `"${name}" was never observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)`,
          expected: 'Conversion events are absent on pages that are not conversion surfaces',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const { events, completion } = nonCompletionFires(auditData, name);
    const falsePositiveSteps = [...new Set(events.map((e) => e.step))];

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: falsePositiveSteps.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: falsePositiveSteps.length > 0
          ? `"${name}" fired on ${falsePositiveSteps.length} non-conversion page(s): ${falsePositiveSteps.join(', ')}`
          : `"${name}" only fired on the conversion surface ("${completion}")`,
        expected: 'A false positive here silently inflates every downstream conversion count',
        evidence: [`Conversion surface: ${completion ?? 'unknown'}`, `False-positive steps: ${falsePositiveSteps.length > 0 ? falsePositiveSteps.join(', ') : 'none'}`],
      },
    };
  },
};

// ── L5.10 — page_view fires on every route ────────────────────────────────────

export const PAGE_VIEW_FIRES_ON_EVERY_ROUTE: ValidationRule = {
  id: 'L5.10',
  rule_id: 'PAGE_VIEW_FIRES_ON_EVERY_ROUTE',
  layer: 'event_firing',
  check: 'page_view fires on every route',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const steps = (auditData.steps_visited ?? []).filter((s) => s !== 'init');

    if (steps.length < 2) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: `Only ${steps.length} page step(s) sampled — nothing to compare coverage across`,
          expected: 'A page_view is recorded per route change',
          evidence: ['Rule skipped — journey reached fewer than 2 distinct steps'],
        },
      };
    }

    const stepHasPageView = (step: string) =>
      auditData.dataLayer.some((e) => e.event === 'page_view' && e.step === step) ||
      auditData.networkRequests.some((r) => trackingSignals.detectGa4([r]).hitCount > 0 && r.step === step);

    const missing = steps.filter((step) => !stepHasPageView(step));

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: missing.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: missing.length > 0
          ? `${missing.length} of ${steps.length} route(s) had no page_view: ${missing.join(', ')}`
          : `page_view recorded on all ${steps.length} routes`,
        expected: 'Funnel and path analysis are meaningless without a page_view per route change',
        evidence: [`Sampled routes: ${steps.join(', ')}`, `Missing page_view: ${missing.length > 0 ? missing.join(', ') : 'none'}`],
      },
    };
  },
};

// ── L5.12 — Micro-conversions fire ────────────────────────────────────────────

export const MICRO_CONVERSIONS_FIRE: ValidationRule = {
  id: 'L5.12',
  rule_id: 'MICRO_CONVERSIONS_FIRE',
  layer: 'event_firing',
  check: 'Micro-conversions fire',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const names = secondaryConversionNames(auditData);
    if (names.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No secondary/micro-conversions declared in Scan Inputs',
          expected: 'Declared secondary events are observed on their surfaces',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const fired = names.filter((n) => eventsNamed(auditData, n).length > 0);
    const missing = names.filter((n) => !fired.includes(n));
    const status: RuleStatus = missing.length === 0 ? 'pass' : fired.length > 0 ? 'warning' : 'fail';

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status,
      severity: this.severity,
      technical_details: {
        found: `${fired.length}/${names.length} declared micro-conversions observed`,
        expected: 'Micro-conversions give early optimisation signal on long consideration cycles',
        evidence: names.map((n) => `${n}: ${fired.includes(n) ? 'observed' : 'missing'}`),
      },
    };
  },
};

// ── L5.13 — Event names match the declared taxonomy ──────────────────────────

export const EVENT_NAMES_MATCH_DECLARED_TAXONOMY: ValidationRule = {
  id: 'L5.13',
  rule_id: 'EVENT_NAMES_MATCH_DECLARED_TAXONOMY',
  layer: 'event_firing',
  check: 'Event names match the declared taxonomy',
  severity: 'medium',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Marketing Ops',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const convention = auditData.namingConvention ?? DEFAULT_CONVENTION;
    const eventNames = [...new Set(auditData.dataLayer.map((e) => e.event).filter(Boolean))];

    if (eventNames.length === 0) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: 'No dataLayer events observed',
          expected: 'Observed event names match the naming convention on file',
          evidence: ['Rule skipped — nothing to check'],
        },
      };
    }

    const violations = eventNames
      .map((name) => ({ name, result: validateEventName(name, convention) }))
      .filter((v) => !v.result.valid);

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: violations.length > 0 ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: violations.length > 0
          ? `${violations.length} of ${eventNames.length} observed event name(s) violate the naming convention`
          : `All ${eventNames.length} observed event name(s) match the naming convention`,
        expected: 'Inconsistent naming makes cross-property comparison impossible',
        evidence: violations.length > 0
          ? violations.map((v) => `"${v.name}": ${v.result.errors.join('; ')}`)
          : ['No naming convention violations found'],
      },
    };
  },
};

// ── L5.14 — Event ordering is correct ─────────────────────────────────────────
//
// Uses the first gtm.js request's timestamp as the "config loaded" baseline
// — the closest proxy this crawl has for "when did the tag manager
// initialize" without a GTM container connection. A conversion event
// observed before that timestamp fired before its own config could have
// processed it.

export const EVENT_ORDERING_IS_CORRECT: ValidationRule = {
  id: 'L5.14',
  rule_id: 'EVENT_ORDERING_IS_CORRECT',
  layer: 'event_firing',
  check: 'Event ordering is correct',
  severity: 'high',
  applies_to: 'all',
  platform_scope: 'any',
  detectable_by: 'crawl',
  owner: 'Frontend',
  requires: ['conversion_surface'],

  test(auditData: AuditData): ValidationResult {
    const name = primaryConversionName(auditData);
    const conversionEvents = name ? eventsNamed(auditData, name) : [];

    const gtmLoad = auditData.networkRequests.find((r) => r.url.includes('googletagmanager.com/gtm.js'));

    if (!name || conversionEvents.length === 0 || !gtmLoad) {
      return {
        rule_id: this.rule_id,
        validation_layer: this.layer,
        status: 'skipped',
        severity: this.severity,
        technical_details: {
          found: !name
            ? 'No primary conversion declared in Scan Inputs'
            : conversionEvents.length === 0
              ? `"${name}" was never observed — see PRIMARY_CONVERSION_EVENT_FIRES (L5.1)`
              : 'No GTM container load observed to establish an ordering baseline',
          expected: 'Config and consent fire before the conversion event',
          evidence: ['Rule skipped — nothing to compare'],
        },
      };
    }

    const earliestConversion = Math.min(...conversionEvents.map((e) => e.timestamp));
    const outOfOrder = earliestConversion < gtmLoad.timestamp;

    return {
      rule_id: this.rule_id,
      validation_layer: this.layer,
      status: outOfOrder ? 'fail' : 'pass',
      severity: this.severity,
      technical_details: {
        found: outOfOrder
          ? `"${name}" fired before the GTM container finished loading — an event that fires before its config is discarded silently`
          : `"${name}" fired after the GTM container loaded`,
        expected: 'Config and consent fire before the conversion event',
        evidence: [`GTM load timestamp: ${gtmLoad.timestamp}`, `Earliest "${name}" timestamp: ${earliestConversion}`],
      },
    };
  },
};

export const L5_RULES: ValidationRule[] = [
  PRIMARY_CONVERSION_EVENT_FIRES,
  GOOGLE_ADS_CONVERSION_EVENT_FIRES,
  META_CONVERSION_EVENT_FIRES,
  TIKTOK_CONVERSION_EVENT_FIRES,
  GA4_CONVERSION_EVENT_FIRES,
  EVENT_FIRES_EXACTLY_ONCE,
  FIRES_ON_COMPLETION_NOT_ON_INTENT,
  PAGE_VIEW_FIRES_ON_EVERY_ROUTE,
  NO_CONVERSION_FIRES_ON_NON_CONVERSION_PAGES,
  MICRO_CONVERSIONS_FIRE,
  EVENT_NAMES_MATCH_DECLARED_TAXONOMY,
  EVENT_ORDERING_IS_CORRECT,
];
