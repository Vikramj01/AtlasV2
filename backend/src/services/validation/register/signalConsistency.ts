/**
 * Cross-signal consistency checker (Pre-Connection Scan Confidence Tiering
 * PRD §6).
 *
 * A client-side crawl runs several independent detectors over the same
 * underlying browser state — a network-request matcher, a dataLayer
 * inventory, a tag-inventory summary built for display — and today nothing
 * checks that they agree. Audit `c9486929-4f8b-4179-8e09-97f610815fba`
 * (openart.ai, PRD §1) shipped three contradictions that are exactly this
 * failure mode: GA4 rendered `Not Detected` in the tag inventory while the
 * same run's dataLayer recorded a `config(G-QYRJB9TLG7)` call; Google Ads
 * rendered `Not Detected` in the inventory while a register rule's own
 * evidence said `tag present`; Reddit appeared in one finding's evidence
 * with nothing in the inventory to cross-check it against.
 *
 * This module runs after all rules resolve and before scoring, comparing
 * each of the five initial assertions (CONF_01–CONF_05) and routing any
 * rule whose verdict a conflict touches to could_not_be_assessed (PRD
 * §4.3 — "Any rule, CONFLICTED → CONFLICT") rather than letting it stand as
 * a confident pass/fail two independent signals disagree about.
 *
 * **Absorption decision** (sprint-scoping call, per the sprint plan's own
 * "recommend absorption to avoid two parallel conflict mechanisms"):
 * `contradictionGuard.ts`'s two hardcoded specs (a click-ID capture rule's
 * FAIL contradicted by its own linker cookie's presence) are exactly
 * CONF_05's shape — an independent source (a cookie, populated by browser
 * behavior the capture rule's own URL-parsing can't see) asserting a fact
 * the rule's FAIL rules out — so they're absorbed here as CONF_05 instances
 * and that file is retired. `clickIdContention.ts` is deliberately **not**
 * absorbed: its conflict isn't two independent sources disagreeing about
 * one entity, it's a single-source artifact of this scanner's own synthetic
 * multi-click-ID injection (journeySimulator.ts injects all seven click IDs
 * in one pass, which no real visit ever does) — a different problem PRD §6
 * doesn't describe, so it stays a separate, upstream pre-filter.
 *
 * **Sources**, per PRD §6's table, as they actually exist in this codebase:
 *  - `NET` — the register's own per-platform matcher (platformDetection.ts,
 *    used by L0.1/L0.2 and the L1 per-platform PRESENT rules for ga4/meta/
 *    tiktok/linkedin/microsoft/openai — but NOT google_ads/meta, see CONF_03).
 *  - `DL` — captured `window.dataLayer` pushes (AuditData.dataLayer).
 *  - `DOM` — here, the Site Setup tag inventory (siteSetupDetector.ts's
 *    `tags[]`, built from services/detection/trackingSignals.ts) — an
 *    independently-maintained network-request matcher used for display
 *    rather than scoring, not a literal DOM/script-tag scan (this codebase
 *    has no separate inline-script inventory to serve as PRD §6's literal
 *    `DOM` source). Independently maintained is what matters for
 *    consistency-checking purposes, not which raw signal it reads.
 *  - `COOKIE` — captured cookie snapshots, read via existing rules'
 *    evidence (GCL_AW_COOKIE_PRESENT, FBC_COOKIE_PRESENT).
 *  - `GTM` (container snapshot) — PRD-listed but not implemented: GTM
 *    container snapshots are an Implementation Health Check concept
 *    (post-connection), not part of the pre-connection Audit Engine's
 *    AuditData. No assertion here uses it.
 */
import type { AuditData, DataLayerEvent, DeclaredPlatform, DetectedTagPlatform, SiteSetupSummary, UnassessableFinding, ValidationResult } from '@/types/audit';
import { platformTagDetected, PLATFORM_LABELS } from './platformDetection';
import logger from '@/utils/logger';

export interface SignalConflict {
  assertion_id: 'CONF_01' | 'CONF_02' | 'CONF_03' | 'CONF_04' | 'CONF_05';
  entity: string;
  source_a: string;
  reading_a: string;
  source_b: string;
  reading_b: string;
  affected_rule_ids: string[];
}

function findResult(results: ValidationResult[], ruleId: string): ValidationResult | undefined {
  return results.find((r) => r.rule_id === ruleId);
}

/**
 * A gtag.js-shaped dataLayer push — `gtag('config', 'G-XXXX')` etc. is
 * implemented as `dataLayer.push(arguments)`, which dataCapture.ts's
 * instrumentation captures with the arguments' own numeric indices as keys
 * (`{0: 'config', 1: 'G-XXXX', ...}`) rather than a named `event` field
 * (see siteSetupDetector.ts's displayNameForUnnamedEvent, which reads the
 * same shape). A named push (`dataLayer.push({event: 'foo'})`, GTM's own
 * shape) always carries `event`, so checking it's unset is what
 * distinguishes "gtag.js itself ran" from an ordinary GTM dataLayer event —
 * only gtag.js's runtime pushes arguments positionally like this.
 */
function gtagPush(ev: DataLayerEvent): { verb: string; target: string } | null {
  if (ev.event) return null;
  const record = ev as unknown as Record<string, unknown>;
  const verb = record['0'];
  const target = record['1'];
  if (typeof verb === 'string' && typeof target === 'string') return { verb, target };
  return null;
}

// ── CONF_01 — config(G-*) in DL vs a GA4 absence verdict from NET ────────────

function checkConf01(auditData: AuditData, results: ValidationResult[]): SignalConflict | null {
  const rule = findResult(results, 'GA4_CONFIG_TAG_PRESENT');
  if (!rule || rule.status !== 'fail') return null;

  const configCall = auditData.dataLayer.map(gtagPush).find((c) => c?.verb === 'config' && c.target.startsWith('G-'));
  if (!configCall) return null;

  return {
    assertion_id: 'CONF_01',
    entity: 'GA4',
    source_a: 'DL',
    reading_a: `gtag('config', '${configCall.target}') observed in dataLayer`,
    source_b: 'NET',
    reading_b: 'GA4_CONFIG_TAG_PRESENT found no request to google-analytics.com/g/collect or analytics.google.com/g/collect',
    affected_rule_ids: ['GA4_CONFIG_TAG_PRESENT'],
  };
}

// ── CONF_02 — any gtag call in DL vs a gtag-loader absence verdict from NET ──

function checkConf02(auditData: AuditData, results: ValidationResult[]): SignalConflict | null {
  const rule = findResult(results, 'GTAG_LOADER_PRESENT');
  if (!rule || rule.status !== 'fail') return null;

  const anyGtagCall = auditData.dataLayer.map(gtagPush).find((c) => c !== null);
  if (!anyGtagCall) return null;

  return {
    assertion_id: 'CONF_02',
    entity: 'gtag loader',
    source_a: 'DL',
    reading_a: `gtag('${anyGtagCall.verb}', '${anyGtagCall.target}') observed in dataLayer — only gtag.js's own runtime pushes arguments positionally like this`,
    source_b: 'NET',
    reading_b: 'GTAG_LOADER_PRESENT found no request to googletagmanager.com/gtag/js',
    affected_rule_ids: ['GTAG_LOADER_PRESENT'],
  };
}

// ── CONF_04 — config(AW-*) in DL vs a Google Ads AW- ID absence from NET ─────

function checkConf04(auditData: AuditData, results: ValidationResult[]): SignalConflict | null {
  const rule = findResult(results, 'GOOGLE_ADS_AW_ID_PRESENT');
  if (!rule || rule.status !== 'fail') return null;

  const configCall = auditData.dataLayer.map(gtagPush).find((c) => c?.verb === 'config' && c.target.startsWith('AW-'));
  if (!configCall) return null;

  return {
    assertion_id: 'CONF_04',
    entity: 'Google Ads conversion ID',
    source_a: 'DL',
    reading_a: `gtag('config', '${configCall.target}') observed in dataLayer`,
    source_b: 'NET',
    reading_b: 'GOOGLE_ADS_AW_ID_PRESENT found no googletagmanager.com/gtag/js?id=AW-... request',
    affected_rule_ids: ['GOOGLE_ADS_AW_ID_PRESENT'],
  };
}

// ── CONF_03 — a platform named in a finding's evidence vs the tag inventory ──
//
// L0.1/L0.2 read platformTagDetected() (platformDetection.ts's own matcher
// list); the Site Setup tag inventory (siteSetup.tags) reads
// trackingSignals.ts's independently-maintained matcher list for the same
// platform. Both ultimately read AuditData.networkRequests, but via two
// separately-authored host-pattern lists that can — and, per the OpenArt
// incident, did — drift apart. Source divergence is itself the conflict
// (PRD §6, CONF_03), regardless of which side is "more right".

const DECLARED_TO_DETECTED_TAG: Partial<Record<DeclaredPlatform, DetectedTagPlatform>> = {
  google_ads: 'google_ads',
  meta: 'meta_pixel',
  tiktok: 'tiktok_pixel',
  linkedin: 'linkedin_insight',
  microsoft: 'microsoft_uet',
  openai: 'openai_pixel',
  reddit: 'reddit_pixel',
  pinterest: 'pinterest_pixel',
};

function checkConf03(auditData: AuditData, siteSetup: SiteSetupSummary, results: ValidationResult[]): SignalConflict[] {
  const conflicts: SignalConflict[] = [];
  const tagByPlatform = new Map(siteSetup.tags.map((t) => [t.platform, t]));
  const declared = new Set(auditData.declared_platforms ?? []);
  const hasResult = (ruleId: string) => results.some((r) => r.rule_id === ruleId);

  for (const [platform, detectedTag] of Object.entries(DECLARED_TO_DETECTED_TAG) as [DeclaredPlatform, DetectedTagPlatform][]) {
    const inventoryEntry = tagByPlatform.get(detectedTag);
    if (!inventoryEntry) continue; // structurally absent from this run's inventory — nothing to cross-check

    const registerVerdict = platformTagDetected(platform, auditData);
    if (registerVerdict === inventoryEntry.detected) continue; // sources agree — no conflict

    // Route only a rule that actually names this platform in this run — a
    // declared platform's finding is DECLARED_PLATFORM_HAS_TAG;
    // an undeclared platform the register found a tag for is named in
    // UNDECLARED_PLATFORM_TAG_DETECTED's evidence. Whole-rule granularity
    // matches every existing suppression mechanism in this pipeline
    // (partitionCoverageAffected, partitionDegradedRuns, clickIdContention) —
    // none of them partially redact one platform out of a composite result.
    const affected: string[] = [];
    if (declared.has(platform) && hasResult('DECLARED_PLATFORM_HAS_TAG')) affected.push('DECLARED_PLATFORM_HAS_TAG');
    if (!declared.has(platform) && registerVerdict && hasResult('UNDECLARED_PLATFORM_TAG_DETECTED')) affected.push('UNDECLARED_PLATFORM_TAG_DETECTED');
    if (affected.length === 0) continue; // sources disagree, but nothing in this run's findings actually cites it

    conflicts.push({
      assertion_id: 'CONF_03',
      entity: PLATFORM_LABELS[platform],
      source_a: 'NET',
      reading_a: `Register detector: ${registerVerdict ? 'tag present' : 'no tag observed'}`,
      source_b: 'DOM',
      reading_b: `Tag inventory: ${inventoryEntry.detected ? 'detected' : 'not observed'}`,
      affected_rule_ids: affected,
    });
  }

  return conflicts;
}

// ── CONF_05 — a cookie set exclusively by platform X implies X's tag ran ─────
//
// Absorbed from contradictionGuard.ts (Click-ID Contention, Contradiction
// Guard & Settle Enforcement PRD W2) — see this file's header. Unchanged
// underlying logic: a platform's own conversion-linker cookie can only be
// populated by resolving the click ID it stores, so a populated cookie and
// a failed capture rule for that same identifier describe one browser state
// two contradictory ways.

interface Conf05Spec {
  /** One or more capture rule_ids whose FAIL this cookie evidence contradicts — checked individually. */
  failing: string[];
  /** The rule_id whose result is checked for the contradicting fact. */
  passing: string;
  /**
   * Whether `passing`'s result establishes the fact — defaults to "status
   * is 'pass'". Override when the fact is narrower than the rule's overall
   * verdict (FBC_COOKIE_PRESENT always returns status: 'skipped' in a crawl
   * context — a genuine Meta-click referrer is required to populate _fbc,
   * which a synthetic crawl can't reproduce — so its evidence, not its
   * status, is what's checked here).
   */
  contradictingFact?: (result: ValidationResult) => boolean;
  entity: string;
  readingA: string;
  readingB: (failingRuleId: string) => string;
}

const CONF_05_SPECS: Conf05Spec[] = [
  {
    failing: ['GCLID_CAPTURED_AT_LANDING', 'GBRAID_CAPTURED_AT_LANDING', 'WBRAID_CAPTURED_AT_LANDING'],
    passing: 'GCL_AW_COOKIE_PRESENT',
    entity: 'Google click ID capture',
    readingA: '_gcl_aw is present — Google\'s own conversion linker can only populate it by resolving one of gclid/gbraid/wbraid',
    readingB: (failingRuleId) => `${failingRuleId} found no matching click ID in the landing URL`,
  },
  {
    failing: ['FBCLID_CAPTURED_AT_LANDING'],
    passing: 'FBC_COOKIE_PRESENT',
    contradictingFact: (result) => result.technical_details.evidence.includes('_fbc present: true'),
    entity: 'Meta click ID capture',
    readingA: '_fbc is present — only ever populated from a real fbclid arriving with a genuine Meta-click referrer, unlike _fbp which the Pixel sets unconditionally',
    readingB: (failingRuleId) => `${failingRuleId} found no fbclid in the landing URL`,
  },
];

function checkConf05(results: ValidationResult[]): SignalConflict[] {
  const byRuleId = new Map(results.map((r) => [r.rule_id, r]));
  const conflicts: SignalConflict[] = [];

  for (const spec of CONF_05_SPECS) {
    const passingResult = byRuleId.get(spec.passing);
    if (!passingResult) continue;
    const holds = spec.contradictingFact ? spec.contradictingFact(passingResult) : passingResult.status === 'pass';
    if (!holds) continue;

    for (const failingRuleId of spec.failing) {
      const failingResult = byRuleId.get(failingRuleId);
      if (failingResult?.status !== 'fail') continue;
      conflicts.push({
        assertion_id: 'CONF_05',
        entity: spec.entity,
        source_a: 'COOKIE',
        reading_a: spec.readingA,
        source_b: 'NET',
        reading_b: spec.readingB(failingRuleId),
        affected_rule_ids: [failingRuleId],
      });
    }
  }

  return conflicts;
}

/** Every CONF_01–CONF_05 assertion, evaluated once over a run's resolved results. */
export function detectSignalConflicts(
  auditData: AuditData,
  siteSetup: SiteSetupSummary,
  results: ValidationResult[],
): SignalConflict[] {
  const conflicts: SignalConflict[] = [];

  const c01 = checkConf01(auditData, results);
  if (c01) conflicts.push(c01);

  const c02 = checkConf02(auditData, results);
  if (c02) conflicts.push(c02);

  conflicts.push(...checkConf03(auditData, siteSetup, results));

  const c04 = checkConf04(auditData, results);
  if (c04) conflicts.push(c04);

  conflicts.push(...checkConf05(results));

  return conflicts;
}

function conflictReason(c: SignalConflict): string {
  // PRD §5's CONFLICT phrase family: "Signals disagree · <source A> reports
  // <a>, <source B> reports <b>."
  return `Signals disagree on ${c.entity} — ${c.source_a} reports: ${c.reading_a}. ${c.source_b} reports: ${c.reading_b}. `
    + 'Two independent detectors read the same underlying state differently, so this can\'t be asserted with confidence either way.';
}

export interface SignalConsistencyPartition {
  assessable: ValidationResult[];
  unassessable: UnassessableFinding[];
  conflicts: SignalConflict[];
}

/**
 * Detects every CONF_01–CONF_05 conflict and routes each affected rule's
 * result to could_not_be_assessed (kind: 'CONFLICT') rather than leaving it
 * standing as a confident pass/fail two independent signals disagree about.
 * `conflicts` is returned separately so the caller can persist it to
 * signal_conflicts — this function has no DB dependency of its own.
 */
export function partitionSignalConflicts(
  results: ValidationResult[],
  auditData: AuditData,
  siteSetup: SiteSetupSummary,
): SignalConsistencyPartition {
  const conflicts = detectSignalConflicts(auditData, siteSetup, results);
  if (conflicts.length === 0) return { assessable: results, unassessable: [], conflicts: [] };

  logger.warn(
    { conflicts },
    'Cross-signal consistency checker fired — routing conflicted rule(s) to could_not_be_assessed rather than shipping a disputed finding',
  );

  const conflictByRuleId = new Map<string, SignalConflict>();
  for (const c of conflicts) {
    for (const ruleId of c.affected_rule_ids) {
      if (!conflictByRuleId.has(ruleId)) conflictByRuleId.set(ruleId, c);
    }
  }

  const assessable: ValidationResult[] = [];
  const unassessable: UnassessableFinding[] = [];
  for (const r of results) {
    const conflict = conflictByRuleId.get(r.rule_id);
    if (!conflict) {
      assessable.push(r);
      continue;
    }
    unassessable.push({
      rule_id: r.rule_id,
      step: 'landing',
      reason: conflictReason(conflict),
      // Pre-Connection Scan Confidence Tiering PRD §4.3 — two independent
      // detectors disagreeing about the same entity is exactly a CONFLICT,
      // not a coverage gap (NOT_OBSERVED).
      kind: 'CONFLICT',
    });
  }

  return { assessable, unassessable, conflicts };
}
