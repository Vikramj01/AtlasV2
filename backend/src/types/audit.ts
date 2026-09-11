// ─── Audit inputs ────────────────────────────────────────────────────────────

import type { NamingConvention } from './taxonomy';

export type FunnelType = 'ecommerce' | 'saas' | 'lead_gen';
export type Region = 'us' | 'eu' | 'global';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

/** The 5 layers of the original (v1) rule library. */
export type ValidationLayerV1 =
  | 'signal_initiation'
  | 'parameter_completeness'
  | 'persistence'
  | 'tag_configuration'
  | 'implementation_drift';

/**
 * The 13 layers of the Check Register v2 rule library (L0-L12).
 * 'parameter_completeness' is deliberately the same literal as its v1
 * counterpart above — same concept, a larger rule set — so the two collapse
 * to one union member rather than needing a v1/v2-qualified name.
 */
export type ValidationLayerV2 =
  | 'scope_configuration'      // L0
  | 'foundation_tags'          // L1
  | 'click_id_capture'         // L2
  | 'storage_durability'       // L3
  | 'cross_domain_continuity'  // L4
  | 'event_firing'             // L5
  | 'parameter_completeness'   // L6
  | 'identity_match_quality'   // L7
  | 'consent'                  // L8
  | 'server_side_delivery'     // L9
  | 'deduplication'            // L10
  | 'reconciliation'           // L11
  | 'hygiene_integrity';       // L12

export type ValidationLayer = ValidationLayerV1 | ValidationLayerV2;

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type RuleStatus = 'pass' | 'fail' | 'warning' | 'skipped' | 'not_run';

// ─── Check Register v2 — Scan Inputs ──────────────────────────────────────────
// Atlas Check Register v1.0 (2 September 2026) — "Scan Inputs" sheet.
// Collected before a v2 scan runs; these drive rule applicability throughout
// the register (see ValidationRule.applies_to / platform_scope below).

/** Which rule library produced a given audit's results — scores are not comparable across versions. */
export type RuleSetVersion = 'v1-legacy' | 'v2';

export type SiteType =
  | 'plg_saas'
  | 'ecommerce'
  | 'lead_gen_b2b'
  | 'marketplace'
  | 'app_install'
  | 'subscription_media';

export type SecondaryMotion = 'none' | 'sales_assisted' | 'hybrid';

export type DeclaredPlatform =
  | 'google_ads'
  | 'meta'
  | 'tiktok'
  | 'linkedin'
  | 'microsoft'
  | 'reddit'
  | 'pinterest'
  | 'openai';

/**
 * Regions field granularity the consent layer (L8) needs — distinct from the
 * legacy `Region` (us/eu/global). ATLAS_OPENAI_ADS_AND_REGIONS_PRD Part B —
 * added 'singapore'/'gcc', removed 'brazil' (inert in every rule; safe to
 * drop outright per the PRD). This is a picker-options/type change only —
 * `traffic_regions` is TEXT[] with no CHECK constraint (migration 20260902002/
 * 20260903001), so an existing audit stored with 'brazil' still round-trips
 * through the DB at runtime even though it no longer typechecks as a
 * TrafficRegion; the region-label renderer (scanInputOptions.ts /
 * TRAFFIC_REGION_LABELS) falls back to the raw string for any unrecognised
 * value instead of throwing. 'switzerland' stays in the type and in L8.ts's
 * REGULATED_TRAFFIC_REGIONS even though it no longer has its own picker
 * chip — see scanInputOptions.ts's "EEA / Switzerland" combined chip.
 */
export type TrafficRegion = 'eea' | 'uk' | 'switzerland' | 'singapore' | 'gcc' | 'us' | 'other';

export type CMP = 'onetrust' | 'cookiebot' | 'usercentrics' | 'custom' | 'none';

export interface DeclaredConversion {
  name: string;
  kind: 'primary' | 'secondary';
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §8 — provenance of the
 * declared_platforms list, capping the severity DECLARED_PLATFORM_HAS_TAG
 * (L0.1) can assert for a missing tag. The PRD models this per-platform;
 * this implementation applies one value per scan run, since Scan Inputs
 * collects the platform list as a single step with no current UI for
 * confirming platforms individually — revisit if that changes.
 *   'CLIENT_CONFIRMED'   — the prospect answered the scope questions themselves.
 *   'OPERATOR_ASSUMED'   — an operator entered it on the prospect's behalf
 *                          (the pre-connection default — see AuditData.declaration_source).
 *   'INFERRED_FROM_SITE' — guessed from what the crawl itself observed.
 */
export type DeclarationSource = 'CLIENT_CONFIRMED' | 'OPERATOR_ASSUMED' | 'INFERRED_FROM_SITE';

/** The four Scan Inputs collected before a Check Register v2 scan runs, plus the optional unlocks. */
export interface ScanInputs {
  // 1. Site type
  site_type: SiteType;
  secondary_motion?: SecondaryMotion;
  // 2. Ad platforms
  declared_platforms: DeclaredPlatform[];
  primary_channel: DeclaredPlatform;
  monthly_spend_band?: string;
  /** See DeclarationSource. Defaults to 'OPERATOR_ASSUMED' when omitted — pre-connection runs default here unless the prospect has answered the scope questions (PRD §8). */
  declaration_source?: DeclarationSource;
  // 3. Regions
  traffic_regions: TrafficRegion[];
  cmp?: CMP;
  // 4. Domains
  website_url: string;
  product_domain?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  // Optional unlocks
  test_email?: string;
  test_phone?: string;
  declared_conversions?: DeclaredConversion[];
}

// ─── Check Register v2 — Rule shape ───────────────────────────────────────────

/**
 * How a rule's applicability is gated by the declared platforms:
 *   'declared' — the sentinel used by L0.1 only: evaluated once per declared
 *                platform (does *that* platform have its tag?), not a single pass/fail.
 *   'any'      — platform-agnostic infrastructure (GTM, dataLayer) — always applicable.
 *   'n/a'      — not platform-gated at all (e.g. domain reachability).
 *   string[]   — only applicable when at least one of these specific platforms is declared.
 */
export type PlatformScope = 'declared' | 'any' | 'n/a' | DeclaredPlatform[];

/** What the rule needs beyond a single browser pass — see the "Beyond the Crawl" sheet. */
export type DetectionMethod = 'crawl' | 'second_pass' | 'credentials' | 'connector';

/**
 * A precondition the crawl must have satisfied before a rule's test() is
 * even worth running — see engine.ts's runRegister() and the "skip, don't
 * fail, what could not be tested" design (Site Evaluation Coverage & Honesty
 * PRD §6.3). 'conversion_surface' is the only value today: it gates every
 * rule that needs a real conversion event/page (L5-L7, L4.3/L4.4) behind
 * step_coverage actually having reached one, per L0.3's own definition of
 * that (see L0.ts) — declared here as an open union so a future phase can
 * add another precondition without changing this shape.
 */
export type RulePrecondition = 'conversion_surface' | 'distinct_product_domain';

// ─── Confidence tiering (Pre-Connection Scan Confidence Tiering PRD §4) ──────
//
// Two orthogonal axes, per the PRD's core principle: "Any verdict that
// asserts an absence requires coverage. Any verdict that asserts a presence
// does not." evidence_class is static (declared at rule definition, below);
// observation_confidence is computed per run, per rule (register/engine.ts's
// deriveObservationConfidence()); the two combine into a verdict distinct
// from the rule's raw pass/fail status (deriveVerdict()).

/**
 * Evidence class (PRD §4.1) — which raw status direction is an absence claim
 * that needs coverage to stand, per rule:
 *   'DIRECT'            — both pass and fail rest on positively observed
 *                          evidence; never gated (e.g. a synthetic click ID
 *                          either is or isn't found in storage — the scanner
 *                          has complete, deterministic knowledge of what to
 *                          look for and searches exhaustively, so there's no
 *                          "we just didn't wait long enough" risk).
 *   'PRESENCE'           — "is X there" — pass is positive evidence, fail is
 *                          an absence claim gated on coverage.
 *   'PRESENCE_INVERSE'   — "X must not be there" — fail is positive evidence,
 *                          pass is the absence claim gated on coverage (e.g.
 *                          a clean PII scan is a liability claim that scales
 *                          with how much traffic was actually captured).
 *   'DERIVED'            — computed from other rules or scope configuration;
 *                          gated direction varies per rule — see
 *                          ValidationRule.gated_direction.
 *   'INFERRED'           — heuristic shape match, never authoritative (e.g.
 *                          sGTM hostname detection); may never emit a FAIL
 *                          verdict regardless of confidence (see
 *                          register/engine.ts's deriveVerdict()).
 */
export type EvidenceClass = 'DIRECT' | 'PRESENCE' | 'PRESENCE_INVERSE' | 'DERIVED' | 'INFERRED';

/** Which raw status direction requires CONFIRMED observation confidence to stand as PASS/FAIL — see ValidationRule.gated_direction and register/engine.ts's gatedDirectionFor(). */
export type GatedDirection = 'fail' | 'pass' | 'both' | 'none';

/**
 * Observation confidence (PRD §4.2) — computed per run, per rule, by
 * register/engine.ts's deriveObservationConfidence():
 *   'CONFIRMED'   — every page in the rule's scope was reached and settled,
 *                   and the evidence channels the rule reads were captured.
 *   'PARTIAL'     — some but not all in-scope pages met that bar (the rule
 *                   still ran and produced evidence, but via an unverified/
 *                   degraded step — see ValidationResult.confidence).
 *   'UNSUPPORTED' — the step the rule depends on was not reached, did not
 *                   settle, or its evidence channel was not captured at all
 *                   (the rule never ran — status: 'skipped').
 *   'CONFLICTED'  — two or more independent detectors disagree about the
 *                   entity this rule evaluates (signalConsistency.ts's
 *                   CONF_01–CONF_05 assertions, or clickIdContention.ts's
 *                   synthetic multi-click-ID injection artifact).
 */
export type ObservationConfidence = 'CONFIRMED' | 'PARTIAL' | 'UNSUPPORTED' | 'CONFLICTED';

/**
 * Coverage-aware verdict (PRD §4.3) — distinct from the rule's raw
 * `status`, and the value a future output-vocabulary-bound renderer must
 * key its phrasing off. Computed by register/engine.ts's deriveVerdict()
 * from (evidence_class, observation_confidence, raw status). `NOT_OBSERVED`,
 * `INCONCLUSIVE` and `CONFLICT` are excluded from pass/fail counts and
 * scoring — never rendered as failures, never silently dropped.
 */
export type Verdict = 'PASS' | 'FAIL' | 'NOT_OBSERVED' | 'INCONCLUSIVE' | 'CONFLICT';

/** A single Check Register v2 rule. */
export interface ValidationRule {
  /** Canonical Check Register ID, e.g. "L1.4" — stable identifier from the spec, shown in the technical appendix. */
  id: string;
  /** Readable slug used everywhere else code keys off a rule (report/DB rows, interpretations), e.g. "GA4_CONFIG_TAG_PRESENT". */
  rule_id: string;
  layer: ValidationLayerV2;
  /** Short label matching the spreadsheet's "Check" column. */
  check: string;
  severity: Severity;
  applies_to: SiteType[] | 'all';
  platform_scope: PlatformScope;
  detectable_by: DetectionMethod;
  owner: string;
  /** Preconditions the crawl must satisfy before test() is worth running — see RulePrecondition above. Omitted (or empty) means "always worth testing once applicable". */
  requires?: RulePrecondition[];
  /**
   * Rule-specific remediation copy shown as the report's "How to fix it"
   * text (PRD "Signal Health Report" Issue 1 — every issue used to render
   * the same "Contact support for details on this rule." placeholder,
   * because this content didn't exist anywhere for the v2 register). A
   * plain string for a rule whose fix doesn't vary by evidence (e.g. "add
   * gtag('event', 'purchase', ...) on the confirmation page"); a function
   * of the result for a rule whose fix names something that varies per
   * audit (a specific platform, cookie, or endpoint) — read
   * technical_details.found/evidence to interpolate it, never .expected
   * (that's the rule's ideal-state text, not evidence).
   */
  remediation: string | ((result: ValidationResult) => string);
  /**
   * Report Honesty PRD Part B — a question for the client, emitted
   * alongside a `fail`/`warning` result and collected into the report's
   * Open Questions section, for a finding that isn't really a defect: a
   * configuration whose intent only the client can know (a second GTM
   * container mid-migration, an undeclared tag from a channel ViMi wasn't
   * told about). Interpolates observed evidence the same way `remediation`
   * does — a plain string when the question doesn't vary by evidence, a
   * function of the result when it names something specific (a container
   * ID, a platform). Optional: most rules describe a real defect and have
   * nothing to ask.
   */
  client_question?: string | ((result: ValidationResult) => string);
  /**
   * Report Correctness Programme PRD Part B3 — how much work fixing this
   * rule takes, authored on the rule itself (or, for a family of rules
   * generated by one factory function, hardcoded once inside that factory)
   * so every rule sharing a remediation shares its effort by construction —
   * no per-rule_id lookup table to fall out of sync as new rule_ids ship.
   * Optional: a v2 rule without one falls back to 'medium' in
   * interpretation/engine.ts's interpretResults(), same as before this
   * field existed.
   */
  estimated_effort?: 'low' | 'medium' | 'high';
  /**
   * Pre-Connection Scan Confidence Tiering PRD §4.1/§10 — static evidence
   * class, required on every rule (a registry unit test asserts this — see
   * register/engine.ts's REGISTER_CLASSIFICATION_COVERAGE test). Determines
   * gated direction via GATED_DIRECTION_BY_EVIDENCE_CLASS unless the class
   * is 'DERIVED', in which case gated_direction below is required instead.
   */
  evidence_class: EvidenceClass;
  /**
   * Required, and meaningful, only when evidence_class is 'DERIVED' — every
   * other evidence class has one fixed gated direction (see
   * GATED_DIRECTION_BY_EVIDENCE_CLASS in register/engine.ts) and must omit
   * this field. A 'DERIVED' rule's gated direction varies per rule (e.g.
   * DECLARED_PLATFORM_HAS_TAG gates 'fail'; SERVER_CONTAINER_FIRST_PARTY_DOMAIN
   * gates 'pass').
   */
  gated_direction?: GatedDirection;
  /**
   * PRD §10.3 — true when this rule's evidence rests on a scanner-injected
   * synthetic value (a click ID/UTM param journeySimulator.ts's
   * makeSyntheticIds() put on the URL) rather than genuine unprompted
   * visitor behavior. Rendered with a standing note that it may not be
   * cited as evidence live campaign traffic behaves identically. Omitted
   * (not `false`) for a rule with no synthetic dependency.
   */
  synthetic_evidence?: boolean;
  test(auditData: AuditData): ValidationResult;
}

// ─── Captured data (from Browserbase) ────────────────────────────────────────

export interface DataLayerItem {
  id: string;
  name?: string;
  price?: number;
  quantity?: number;
  [key: string]: unknown;
}

/**
 * A single push to window.dataLayer captured during journey simulation.
 * GA4 ecommerce fields are typed explicitly; all other fields accessible via
 * the index signature.
 */
export interface DataLayerEvent {
  event: string;
  timestamp: number;
  step: string;
  // GA4 ecommerce purchase parameters
  transaction_id?: string;
  value?: number | string;
  currency?: string;
  coupon?: string;
  shipping?: number | null;
  items?: DataLayerItem[];
  user_id?: string;
  event_id?: string;
  gclid?: string;
  user_data?: {
    email?: string;
    phone?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NetworkRequest {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  timestamp: number;
  step: string;
  loadTime?: number; // ms — used by GTM_CONTAINER_LOADED rule
  /** HTTP response status, when the response was observed (dataCapture.ts's response listener). */
  statusCode?: number;
  /** True when Playwright's own 'requestfailed' fired (DNS error, connection refused, blocked by client, etc.) — used by NO_TAG_LOAD_ERRORS (L1.16). */
  failed?: boolean;
}

/**
 * A cookie's full attribute set, as Playwright's context.cookies() reports
 * it — the flat name→value map on CookieSnapshot/AuditData.cookies can't
 * answer "how long does this live" or "is it scoped to the parent domain",
 * which the Check Register v2 Storage Durability layer (L3) needs. expires
 * is Unix seconds, or -1 for a session cookie (Playwright's convention —
 * mirrored here rather than reinvented).
 */
export interface DetailedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface CookieSnapshot {
  step: string;
  cookies: Record<string, string>;
  /** Optional — only populated by dataCapture.ts's captureCookies(); absent from hand-built fixtures/proxy captures. */
  detailed?: DetailedCookie[];
}

export interface LocalStorageSnapshot {
  step: string;
  entries: Record<string, string>;
}

/**
 * A browser console error or uncaught exception observed during a step —
 * see dataCapture.ts's interceptConsoleErrors.
 *
 * frame_url (Report Correctness Programme PRD Part C1/C5) — the URL of the
 * script that produced the message (Playwright ConsoleMessage.location().url),
 * used as a best-effort proxy for which frame/origin it came from: a
 * cross-origin or sandboxed ad/consent iframe's own script reports a
 * different-origin (or blank/empty) location, distinguishing it from a
 * genuine top-document error. Undefined for a `pageerror` (uncaught
 * exception) — Playwright doesn't expose a script location for those — and
 * for a ConsoleError captured before this field existed; both are treated
 * as top-document (unknown origin is never proof of a cross-origin iframe,
 * so it's never excluded on that basis alone — see ambientErrorFilter.ts).
 */
export interface ConsoleError {
  message: string;
  step: string;
  frame_url?: string;
}

// ─── GTM container snapshot (for tag_configuration layer) ────────────────────

export interface GTMConsentSettings {
  consentStatus: 'NOT_SET' | 'NEEDED' | 'NOT_NEEDED';
  consentType?: string[];
}

export interface GTMTag {
  tagId: string;
  name: string;
  type: string;
  firingTriggerId: string[];
  blockingTriggerId?: string[];
  parameter?: Array<{ type: string; key: string; value?: string; list?: unknown[] }>;
  consentSettings?: GTMConsentSettings;
  tagFiringOption?: string;
  monitoringMetadata?: unknown;
}

export interface GTMTrigger {
  triggerId: string;
  name: string;
  type: string;
  filter?: Array<{ type: string; parameter: Array<{ type: string; key: string; value?: string }> }>;
  autoEventFilter?: unknown[];
  customEventFilter?: unknown[];
  parameter?: Array<{ type: string; key: string; value?: string }>;
}

export interface GTMVariable {
  variableId: string;
  name: string;
  type: string;
  parameter?: Array<{ type: string; key: string; value?: string }>;
}

export interface GTMContainerSnapshot {
  container_id: string;
  fetched_at: string;
  source: 'gtm_api' | 'manual_upload';
  tags: GTMTag[];
  triggers: GTMTrigger[];
  variables: GTMVariable[];
  built_in_variables: string[];
  consent_default_tag: GTMTag | null;
}

// ─── CSE signal snapshot (for implementation_drift layer) ────────────────────

/**
 * One detected signal on one page, reconstructed from detected_signals + crawl_pages.
 * Attached to AuditData.crawlSignals by the drift job worker before rules run.
 */
export interface CrawlSignalSnapshot {
  page_url: string;
  signal_type: string;
  signal_name: string | null;
  signal_id: string | null;
  health_status: 'healthy' | 'degraded' | 'missing' | 'duplicate' | 'misconfigured';
  parameters: Record<string, unknown> | null;
}

// ─── Site Setup detection (informational, non-scored) ─────────────────────────

export type DetectedTagPlatform =
  | 'ga4'
  | 'meta_pixel'
  | 'google_ads'
  | 'linkedin_insight'
  | 'tiktok_pixel'
  | 'microsoft_uet'
  | 'openai_pixel'
  // Pre-Connection Scan Confidence Tiering PRD §6, CONF_03 — reddit/
  // pinterest previously had no tag-inventory entry at all despite the
  // register's own platformDetection.ts covering both as DeclaredPlatforms,
  // so a finding naming either (UNDECLARED_PLATFORM_TAG_DETECTED) had
  // nothing to cross-check against — a structural version of the OpenArt
  // Reddit-inventory-divergence bug (PRD §1.1 item 3). Closed by adding
  // both here rather than by fixing the finding in isolation.
  | 'reddit_pixel'
  | 'pinterest_pixel';

export interface DataLayerEventInventoryEntry {
  event_name: string;
  occurrence_count: number;
  parameter_keys: string[];
  steps_seen: string[];
}

export interface DetectedTagSignal {
  platform: DetectedTagPlatform;
  detected: boolean;
  ids: string[];
  hit_count: number;
  evidence_urls: string[];
}

export interface DetectedGtmContainer {
  detected: boolean;
  container_ids: string[];
  /** The client's connected GTM container (OAuth/manual upload), if one exists. */
  connected_container_id: string | null;
  /**
   * true/false when a connected container exists and can be compared against what
   * was live-detected; null when there's nothing connected to compare against.
   */
  ids_match: boolean | null;
}

export type ServerSideGtmHeuristic =
  | 'domain_keyword'
  | 'firstparty_measurement_protocol_shape'
  | 'firstparty_capi_forward_shape';

export interface PossibleServerSideGtm {
  detected: boolean;
  confidence: 'low' | 'medium';
  candidate_hosts: string[];
  matched_heuristics: ServerSideGtmHeuristic[];
  evidence_urls: string[];
  caveat: string;
}

export interface SiteSetupSummary {
  generated_at: string;
  datalayer_inventory: DataLayerEventInventoryEntry[];
  tags: DetectedTagSignal[];
  gtm_container: DetectedGtmContainer;
  possible_server_side_gtm: PossibleServerSideGtm;
}

// ─── Step coverage (Site Evaluation Coverage & Honesty PRD, Phase 1) ─────────

/**
 * How a journey step's URL was resolved. Phase 1 (journeySimulator.ts) only
 * ever produces 'user_supplied' (present in the caller's url_map) or
 * 'fallback_landing' (silently substituted the homepage). 'sitemap',
 * 'nav_link' and 'heuristic' are Phase 2 values, populated once
 * stepUrlResolver.ts ships — declared here now so StepCoverage.source's
 * type doesn't need to change shape when Phase 2 lands.
 */
export type StepUrlSource = 'user_supplied' | 'sitemap' | 'nav_link' | 'heuristic' | 'fallback_landing';

/**
 * How a step's navigation actually settled (Platform Attribution &
 * Determinism PRD Part B) — the replacement for the old binary "networkidle,
 * or whatever domcontentloaded gives you in 10s" fallback, which made a fast
 * degraded run and a fully-settled run indistinguishable in the output.
 * 'settled': domcontentloaded succeeded and no tracked request was in
 * flight for the full quiet period, within budget. 'quiet_period_cap_reached':
 * domcontentloaded succeeded but the quiet period was never reached before
 * the settle budget ran out — a heavy SPA with continuous background traffic
 * (Amplitude, Cloudflare beacons, ...) is the typical case this exists for.
 * 'navigation_failed': domcontentloaded itself never completed.
 */
export type SettleOutcome = 'settled' | 'quiet_period_cap_reached' | 'navigation_failed';

/**
 * Run-level settle reliability (Pre-Connection Scan Confidence Tiering PRD
 * §7.3) — computed once per run from every step's settle_outcome plus
 * whether the declared conversion surface itself settled (see
 * reporting/coverage.ts's computeRunQuality). Distinct from
 * StepCoverage.degraded/ReportCoverage.partial, which flag *which* steps
 * didn't settle: run_quality is the run-wide verdict on whether that's bad
 * enough to withhold a client-facing report at all.
 *   'COMPLETE' — every in-scope step reached 'settled'.
 *   'PROVISIONAL' — at least one step didn't reach 'settled', but the run
 *      still clears the INSUFFICIENT bar below. Renders with the run
 *      quality stated in the report header, not blocked.
 *   'INSUFFICIENT' — the declared conversion surface (a step distinct from
 *      landing that navigated successfully) never settled, or fewer than
 *      two steps settled overall. Blocks a client-facing PDF/JSON/zip
 *      export (see routes/audits.ts's POST /:audit_id/export).
 */
export type RunQuality = 'COMPLETE' | 'PROVISIONAL' | 'INSUFFICIENT';

/** Whether a step's declared `waitFor` selector matched before its own timeout, or wasn't declared for this step at all. */
export type WaitForOutcome = 'matched' | 'timed_out' | 'not_declared';

/**
 * Per-step provenance for one journey step — did the crawl actually reach a
 * page distinct from the landing page, or silently fall back to it? This is
 * the data L0.3 (CONVERSION_SURFACE_IDENTIFIED) is rewritten against: without
 * it, a step relabelled 'checkout' that never left the homepage is
 * indistinguishable from a real checkout visit.
 */
export interface StepCoverage {
  step: string;
  requested_url: string;
  /** Playwright's page.url() after navigation settled — reflects any redirect the site performed. Absent when navigation never completed. */
  final_url?: string;
  source: StepUrlSource;
  /**
   * Whether this step's URL (final_url when available, else requested_url)
   * differs from the landing step's, on a normalised comparison — lowercase
   * origin + pathname, trailing slash stripped, hash/query removed (query
   * must be dropped because the landing URL carries injected synthetic
   * click-ID/UTM params). Always false for the landing step itself.
   */
  distinct_from_landing: boolean;
  navigation_success: boolean;
  error?: string;
  /**
   * How this step's navigation settled (Platform Attribution & Determinism
   * PRD B-W1/B-W2). Absent for a StepCoverage captured before this field
   * existed, or built outside journeySimulator.ts (hand-built fixtures).
   */
  settle_outcome?: SettleOutcome;
  /** Milliseconds spent from the start of goto to the settle decision. */
  settle_ms?: number;
  /**
   * Total navigation attempts made for this step, including the first
   * (Pre-Connection Scan Confidence Tiering PRD §7.2) — 1 when it settled
   * on the first try, up to 1 + DEFAULT_SETTLE_RETRY_CONFIG.maxAttempts
   * when every attempt failed to settle. Absent for a StepCoverage captured
   * before this field existed, or built outside journeySimulator.ts.
   */
  settle_attempts?: number;
  /** Whether this step's declared `waitFor` (if any) matched before its own 5s timeout. */
  wait_for_outcome?: WaitForOutcome;
  /**
   * The HTTP status code of the navigation response (Report Correctness
   * Programme PRD Part C1/C2) — Playwright's Response.status() for this
   * step's page.goto(), captured by gotoAndSettle() (dataCapture.ts).
   * Absent when navigation failed outright (no response to read a status
   * from — see navigation_success/settle_outcome) or for a StepCoverage
   * built before this field existed. Used by L0.ts's isVerifiedStep() to
   * confirm a 'heuristic' (guessed) step actually resolved to a real page
   * (2xx) before it can count as the conversion surface.
   */
  http_status?: number;
  /** Count of tracked (dataCapture.ts's shouldCaptureUrl) requests with neither a response nor a failure recorded yet, at the moment this step's cookie/storage snapshot was taken. */
  requests_in_flight_at_snapshot?: number;
  /**
   * True when this step's own observation can't be trusted as complete —
   * settle hit its cap, navigation failed outright, or a declared waitFor
   * timed out. A rule that asserts a request/cookie was or wasn't observed
   * can't tell "genuinely absent" apart from "the scan didn't wait long
   * enough" when this is true — see B-W3 (partial run)/B-W4 (absence vs.
   * failure) and services/reporting/degradationSuppression.ts.
   */
  degraded?: boolean;
}

/**
 * What journeySimulator.ts observed dismissing a consent banner on the
 * landing step (Site Evaluation Coverage & Honesty PRD §6.5) —
 * detectConsentBanner/dismissConsentBanner in services/detection/
 * consentBanner.ts. tags_before/tags_after are DeclaredPlatform keys (not
 * display labels) so a future rule can compare them directly against
 * AuditData.declared_platforms. Undefined AuditData.consent_capture (not
 * this interface's own fields) is what a caller checks for "was consent
 * handling attempted at all" — see AuditData.consent_capture's docstring.
 */
export interface ConsentCapture {
  banner_present: boolean;
  vendor?: CMP;
  dismissed: boolean;
  /** The declared Scan Input, threaded through for convenience — same value as AuditData.cmp. */
  declared_cmp?: CMP;
  tags_before: string[];
  tags_after: string[];
}

// ─── AuditData passed to validation engine ───────────────────────────────────

export interface AuditData {
  audit_id: string;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  /** Which rule library evaluates this AuditData. Defaults to 'v1-legacy' when absent (existing callers). */
  rule_set_version?: RuleSetVersion;
  // Check Register v2 Scan Inputs — present when rule_set_version === 'v2'.
  site_type?: SiteType;
  secondary_motion?: SecondaryMotion;
  declared_platforms?: DeclaredPlatform[];
  /** See ScanInputs.declaration_source — read by DECLARED_PLATFORM_HAS_TAG (L0.1) to cap its severity. */
  declaration_source?: DeclarationSource;
  primary_channel?: DeclaredPlatform;
  monthly_spend_band?: string;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP;
  product_domain?: string;
  /**
   * Result of a live HTTP reachability probe against product_domain, run by
   * the caller (journeySimulator.ts's probeDomainReachable) before rules run
   * — same pattern as sgtmVerified below. Undefined when product_domain was
   * never set or equals website_url (nothing distinct to probe); L0.4 treats
   * that as 'skipped', not as unreachable.
   */
  product_domain_reachable?: boolean;
  /**
   * The client's connected GTM container ID (via OAuth/manual upload —
   * getConnectedGtmContainerId), resolved by the caller before rules run —
   * same "resolve async, read sync" pattern as product_domain_reachable and
   * sgtmVerified below. Used by CONTAINER_ID_MATCHES_DECLARED (L1.2) to
   * compare against the container ID(s) actually observed loading on the
   * page; undefined when the audit has no associated client or the client
   * has nothing connected, in which case L1.2 has nothing to compare
   * against and is 'skipped', not failed.
   */
  connected_gtm_container_id?: string;
  /**
   * Every journey step name the simulator actually navigated to, regardless
   * of whether any tracking request fired there — the canonical "pages
   * sampled" list. networkRequests only contains requests matching a
   * tracked platform URL pattern, so it can't answer "which pages did the
   * crawl visit" on its own (a page with a broken tag would look identical
   * to a page the crawl never reached). Used by
   * TAGS_PRESENT_ACROSS_SAMPLED_PAGES (L1.13).
   */
  steps_visited?: string[];
  /**
   * Per-step URL provenance — see StepCoverage above. Undefined for AuditData
   * built outside journeySimulator.ts (Journey-Builder mode's proxyAuditData,
   * hand-built test fixtures); L0.3 falls back to its old label-based logic
   * in that case rather than treating a missing array as "nothing distinct".
   */
  step_coverage?: StepCoverage[];
  /**
   * Consent-banner detection/dismissal observed on the landing step — see
   * ConsentCapture above. Undefined means consent handling was never
   * attempted for this AuditData (Journey-Builder mode, hand-built
   * fixtures, or an AuditData predating this field) — distinct from a
   * ConsentCapture with banner_present: false, which means handling ran
   * and genuinely found no banner.
   */
  consent_capture?: ConsentCapture;
  /**
   * The landing page's URL after navigation settled (Playwright's page.url()
   * — reflects any redirect chain the site itself performed), captured by
   * journeySimulator right after the landing goto resolves. Compared against
   * urlParams (what Atlas actually sent) to detect whether a redirect
   * stripped click ID / UTM params — see LANDING_REDIRECT_PRESERVES_QUERY_
   * STRING (L2.9) and CAPTURE_OCCURS_BEFORE_REDIRECT_COMPLETES (L2.10).
   * Undefined for AuditData built outside journeySimulator (journey-mode's
   * proxyAuditData, hand-built test fixtures) — both rules treat that as
   * 'skipped', not a redirect failure.
   */
  landing_final_url?: string;
  /**
   * document.referrer as read by the landing page, after journeySimulator
   * sets a synthetic Referer header (simulating arrival via an ad click) on
   * the landing navigation. Used by REFERRER_PRESERVED_THROUGH_ENTRY
   * (L2.11); undefined (not '') means referrer capture was never attempted
   * for this AuditData.
   */
  landing_referrer_captured?: string;
  checkout_domain?: string;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[];
  dataLayer: DataLayerEvent[];
  networkRequests: NetworkRequest[];
  cookieSnapshots: CookieSnapshot[];
  localStorageSnapshots: LocalStorageSnapshot[];
  /**
   * Synthetic click ID / UTM values journeySimulator injected into the
   * landing URL — gclid/fbclid required (every caller already sets them);
   * the rest are optional so existing callers (orchestrator.ts's journey
   * mode, worker.ts) that only ever set gclid/fbclid stay valid as-is. See
   * makeSyntheticIds() in journeySimulator.ts.
   */
  injected: {
    gclid: string;
    fbclid: string;
    gbraid?: string;
    wbraid?: string;
    ttclid?: string;
    li_fat_id?: string;
    msclkid?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
  test_email?: string;
  test_phone?: string;
  // Derived fields — flattened by journeySimulator for quick rule access
  urlParams?: Record<string, string>;      // Landing page URL params
  storage?: Record<string, string>;        // localStorage at conversion step
  cookies?: Record<string, string>;        // Merged cookie map (all steps)
  /**
   * sessionStorage, merged the same way as storage (localStorage) above —
   * captured separately because Storage Durability (L3) needs to tell
   * "written to sessionStorage only" (destroyed on tab close) apart from
   * "written to localStorage/a cookie" (survives it), which the flat
   * `storage` field alone can't distinguish.
   */
  sessionStorage?: Record<string, string>;
  /**
   * Full cookie attribute set (domain/expires/secure/sameSite) merged
   * across all steps, last-wins per name — the flat `cookies` map above
   * only carries name→value, which can't answer Storage Durability's
   * (L3) questions about cookie lifetime, domain scoping, or SameSite/
   * Secure correctness.
   */
  detailedCookies?: DetailedCookie[];
  /**
   * Check Register v2 Cross-Domain Continuity (L4) inputs — all captured by
   * journeySimulator.ts only when product_domain and/or checkout_domain is
   * set to a genuinely distinct, reachable host (reusing the L0.4/L0.4-style
   * reachability probe); left undefined otherwise, which the L4 rules that
   * read them treat as 'skipped', not a failure. outboundCrossDomainLinks
   * comes from a DOM scan of the landing page's <a href> tags, not from
   * either boundary-domain visit itself. marketingGa4ClientId is the single
   * "before" baseline shared by both boundary checks (captured once, right
   * before the first of the two domains is visited). L4.3/L4.4 read
   * whichever of the product/checkout pair actually got populated — an
   * ecommerce site boundary-checks checkout_domain (hosted checkout), a
   * plg_saas/marketplace site boundary-checks product_domain (app
   * subdomain); a site with both set has product_domain take precedence.
   */
  marketingGa4ClientId?: string;
  productDomainGa4ClientId?: string;
  productDomainSessionStartDetected?: boolean;
  checkoutDomainGa4ClientId?: string;
  checkoutDomainSessionStartDetected?: boolean;
  outboundCrossDomainLinks?: { total: number; withGl: number };
  pageMetadata?: Record<string, unknown>;  // Misc page metadata
  // IHC extensions — absent when the respective data source is not connected
  gtmContainer?: GTMContainerSnapshot;     // tag_configuration layer input
  crawlSignals?: CrawlSignalSnapshot[];    // implementation_drift layer input (current run)
  baselineAuditData?: AuditData;           // implementation_drift layer input (baseline run)
  // True when the client has a verified server-side GTM endpoint on file
  // (client_platforms.platform = 'sgtm', is_verified = true). Resolved by the
  // caller before rules run — rules stay synchronous and don't hit the DB
  // themselves. Undefined when the connection has no associated client_id
  // (e.g. an org-level GTM connection not linked to a specific client).
  sgtmVerified?: boolean;
  /**
   * The org's Naming Conventions config (services/signals/namingConvention.ts),
   * resolved by the caller before rules run — same "resolve outside, read
   * inside" pattern as sgtmVerified/connected_gtm_container_id above. Used
   * by EVENT_NAMES_MATCH_DECLARED_TAXONOMY (L5.13). Falls back to
   * DEFAULT_CONVENTION inside the rule when undefined (org never
   * configured one), so this is never itself a reason to skip.
   */
  namingConvention?: NamingConvention;
  /**
   * Console errors and uncaught exceptions observed across the whole
   * crawl (dataCapture.ts's interceptConsoleErrors, registered once
   * alongside interceptNetworkRequests). Undefined — not an empty array —
   * when console capture never ran for this AuditData (hand-built
   * fixtures, journey-mode's proxyAuditData); the L12 rules that read this
   * treat that as 'skipped', since an empty array from a real crawl and
   * "we never checked" need different verdicts.
   */
  consoleErrors?: ConsoleError[];
}

// ─── API inputs ───────────────────────────────────────────────────────────────

export interface StartAuditInput {
  website_url: string;
  funnel_type: FunnelType;
  region?: Region;
  url_map: Record<string, string>;
  test_email?: string;
  test_phone?: string;
}

export interface AuditStartResponse {
  audit_id: string;
  status: AuditStatus;
  created_at: string;
}

export interface AuditStatusResponse {
  audit_id: string;
  status: AuditStatus;
  progress: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

// ─── Validation results ───────────────────────────────────────────────────────

export interface ValidationResult {
  rule_id: string;
  validation_layer: ValidationLayer;
  status: RuleStatus;
  severity: Severity;
  technical_details: {
    found: string;
    expected: string;
    evidence: string[];
  };
  /**
   * Per-platform disaggregation of this result — populated by a rule whose
   * platform_scope is 'declared' (L0.1's per-platform fan-out) or an array
   * of more than one platform (Platform Attribution & Determinism PRD Part
   * A). `status` above stays the rule's overall verdict ('fail' if it
   * failed for ANY platform in scope) so nothing that reads `status` needs
   * to change; this is additional data for a consumer — today only
   * buildV2PlatformBreakdown() — that needs to know it failed for Meta but
   * passed for TikTok, rather than crediting/blaming every scoped platform
   * identically for one shared scalar. Absent for a rule not yet migrated,
   * or one whose platform_scope is a single platform (nothing to
   * disaggregate) — consumers fall back to `status` in that case.
   */
  platform_outcomes?: Partial<Record<DeclaredPlatform, RuleStatus>>;
  /**
   * Report Honesty PRD Part A — disclosure, not de-rating: never read by
   * scoring.ts, never changes severity or counts. 'confirm' means this
   * result depends (via the rule's `requires`) on a step whose provenance
   * wasn't verified — StepUrlSource 'heuristic' ("path guess"), or the step
   * itself degraded (StepCoverage.degraded — settle capped, navigation
   * failed, or a waitFor timed out). 'high' otherwise, including for any
   * rule with no step-level `requires` at all — there's no depended-on step
   * to distrust, so this is never silently absent (§A2/W1). Set by
   * engine.ts's runRegister() only on a result that actually ran (not on a
   * 'skipped' result, which the technical appendix excludes anyway).
   */
  confidence?: 'high' | 'confirm';
  /**
   * Pre-Connection Scan Confidence Tiering PRD §4.2 — the full 4-state
   * observation-confidence axis, computed alongside `confidence` above by
   * register/engine.ts's runRegister(). Distinct question from `confidence`
   * (which answers only "did this depend on an unverified/degraded step"):
   * this generalizes it to also cover a rule that never ran at all
   * ('UNSUPPORTED', mirroring status: 'skipped') and a rule caught in a
   * cross-signal conflict ('CONFLICTED', mirroring an UnassessableFinding
   * with kind: 'CONFLICT'). Absent for a result predating this field.
   */
  observation_confidence?: ObservationConfidence;
  /**
   * Pre-Connection Scan Confidence Tiering PRD §4.3 — the coverage-aware
   * verdict, computed from (evidence_class, observation_confidence, status)
   * by register/engine.ts's deriveVerdict(). `status` above is unchanged
   * and still what every existing consumer (scoring, reporting, PDF) reads;
   * `verdict` is additive, for a future output-vocabulary-bound renderer.
   */
  verdict?: Verdict;
  /**
   * PRD §4.4 — present only when observation_confidence: 'PARTIAL' capped
   * `severity` down from the rule's declared value (to 'high', labelled
   * provisional). `severity` above always holds the *effective*
   * (post-ceiling) value; this records what it would have been.
   */
  severity_capped_from?: Severity;
}

// ─── Scores ───────────────────────────────────────────────────────────────────

/**
 * How many of a composite score's constituent validation layers actually
 * produced a non-skipped result this run, out of how many the score is
 * defined over (Signal Health Report: Evidence Integrity & Presentation
 * PRD §3.6/W5) — e.g. Optimization Strength is scoped to L6
 * parameter_completeness + L7 identity_match_quality; when L6 was excluded
 * from the scan, layers_tested is 1 and layers_total is 2. A consumer uses
 * this to avoid printing a confident qualitative label ("Strong") computed
 * from only half of what the label's name promises to cover. Additive and
 * optional so existing frontend consumers of AuditScores (out of scope for
 * this PRD) are unaffected — only the PDF generator reads it today.
 */
export interface ScoreCoverage {
  layers_tested: number;
  layers_total: number;
}

export interface AuditScores {
  /**
   * Scoring & Coverage Gate PRD §9.1.4 — null when coverage_ratio across
   * this score's layers (all 13, for this one) falls below
   * COVERAGE_GATE_THRESHOLD (register/layers.ts, 0.60): "A partial score
   * would imply confidence the run does not support." Renders as a
   * Coverage Gate panel, never as a number and never as a blank (§9.1.5).
   * Non-null for a v1-legacy score (scoring/engine.ts's calculateScores
   * has no coverage-gate concept) and for any v2 score predating this PRD.
   */
  conversion_signal_health: number | null;
  /** Null under the same gate, applied at this score's own (smaller) layer scope — see attribution_risk_coverage. PRD §9.3: a dimension with no scored layers renders 'Not assessed', never a default-safe label like the old 'Low'/'Moderate'/'High' fallback for zero applicable rules. */
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical' | null;
  optimization_strength: 'Weak' | 'Moderate' | 'Strong' | null;
  data_consistency_score: 'Low' | 'Medium' | 'High' | null;
  /**
   * Set only alongside a withheld (null) conversion_signal_health — PRD
   * §9.1.4's literal reason code. Sub-scores withhold the same way but
   * don't get their own reason code; the *_coverage field alongside each
   * already states how many of its (smaller) layer set scored.
   */
  score_withheld_reason?: 'INSUFFICIENT_LAYER_COVERAGE';
  /** Distinct validation_layer values with any result at all vs. with a non-skipped result — the "N of M layers scanned" figure for the header composite. conversion_signal_health_coverage.layers_total is always 13 (ALL_V2_LAYERS.length, register/layers.ts) — see Report Correctness Programme PRD Part D1. */
  conversion_signal_health_coverage?: ScoreCoverage;
  attribution_risk_coverage?: ScoreCoverage;
  optimization_strength_coverage?: ScoreCoverage;
  data_consistency_coverage?: ScoreCoverage;
  /**
   * The raw severity-weighted units behind conversion_signal_health
   * (Report Correctness Programme PRD Part D3) — numerator is the summed
   * weight of every passing, non-skipped result; denominator is the summed
   * weight of every non-skipped (scored) result. Stored on the audit row
   * (audits.conversion_signal_health_numerator/_denominator) so a later
   * audit for the same site can compare its own denominator against this
   * one — a score that moved because the denominator changed (coverage,
   * declared platforms, a register version bump) is a different fact from
   * one that moved because the site changed, and the client will ask
   * which. Undefined for a v1-legacy score (scoring/engine.ts's
   * calculateScores doesn't compute a weighted denominator).
   */
  conversion_signal_health_numerator?: number;
  conversion_signal_health_denominator?: number;
}

// ─── Report coverage (Site Evaluation Coverage & Honesty PRD §6.4) ───────────

export interface CoverageLayerNotTested {
  layer: ValidationLayerV2;
  label: string;
  reason: string;
  /**
   * Report Correctness Programme PRD Part D2 — "not applicable" (this
   * site/scan's own declared configuration means the layer has nothing to
   * check — an undeclared platform, a site_type L4 doesn't apply to, no
   * product/checkout domain declared) must be visibly distinct from "not
   * scanned" (in scope for this site, but this run didn't get there — the
   * crawl never reached the conversion surface it needed, or the layer
   * isn't shipped in the register yet). A site with no cross-domain
   * journey is not deficient for L4 not running; a site whose crawl never
   * reached checkout genuinely might be.
   */
  state: 'not_applicable' | 'not_scanned';
}

/**
 * "How much of the site did this scan actually reach" — additive on
 * executive_summary, built by reporting/coverage.ts's buildCoverageSummary()
 * from step_coverage + the register's results. Undefined (not present with
 * zero-valued fields) whenever step_coverage itself is undefined — per
 * CLAUDE.md rule 12 (no fabricated UI data), the frontend banner and PDF
 * section render only when this is present, never a synthesized "0 pages"
 * state for AuditData that never captured coverage in the first place.
 */
export interface ReportCoverage {
  pages_requested: number;
  /** Count of unique normalised URLs actually, successfully navigated to — see journeySimulator.ts's normalizeUrlForCoverage. */
  pages_distinct: number;
  steps: StepCoverage[];
  layers_not_tested: CoverageLayerNotTested[];
  /** Rules whose test() actually ran (pass/fail/warning), or that were skipped for a reason unrelated to crawl coverage. */
  rules_tested: number;
  /** Rules skipped specifically because a `requires` precondition (engine.ts) went unmet — the coverage-driven subset of all skips. */
  rules_not_tested: number;
  /**
   * True when any step's navigation degraded (StepCoverage.degraded) —
   * Platform Attribution & Determinism PRD B-W3. Surfaced the same way
   * fallback_landing coverage already is: a run that didn't fully settle
   * shouldn't silently emit confident pass/fail verdicts for
   * observation-dependent rules (see degradationSuppression.ts, B-W4).
   */
  partial: boolean;
  /** Step names that degraded — empty when `partial` is false. */
  degraded_steps: string[];
  /**
   * Run-level settle-reliability verdict (Pre-Connection Scan Confidence
   * Tiering PRD §7.3) — see RunQuality's docstring. Always present
   * whenever ReportCoverage itself is (both derive from the same
   * step_coverage precondition), computed by
   * reporting/coverage.ts's computeRunQuality.
   */
  run_quality: RunQuality;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface ReportIssue {
  rule_id: string;
  validation_layer: ValidationLayer;
  severity: Severity;
  problem: string;
  why_it_matters: string;
  recommended_owner: string;
  fix_summary: string;
  estimated_effort: 'low' | 'medium' | 'high';
}

export interface JourneyStageIssue {
  rule_id: string;
  /** Plain-language headline for this issue (see getIssueHeadline in the interpretation engine). */
  label: string;
}

export interface JourneyStage {
  stage: string;
  status: RuleStatus;
  issues: JourneyStageIssue[];
}

export interface PlatformFailedRuleDetail {
  rule_id: string;
  /** Full business-impact sentence(s) for this rule (see getIssueImpact in the interpretation engine). */
  impact: string;
}

export interface PlatformBreakdown {
  platform: string;
  status: 'healthy' | 'at_risk' | 'broken' | 'not_included';
  risk_explanation: string;
  failed_rules: string[];
  failed_rule_details: PlatformFailedRuleDetail[];
}

/**
 * A rule result excluded from every client-facing finding, count, and score
 * because its evidence cites a journey step that resolved to
 * StepCoverage.source === 'fallback_landing' (Signal Health Report:
 * Evidence Integrity & Presentation PRD §5/W3) — the scan substituted the
 * landing page for a step it couldn't reach, so a result naming that step
 * is evidence about the landing page, mislabeled, not a real finding about
 * the step. Decided default is "suppress, do not annotate": these never
 * appear in issues/journey_stages/platform_breakdown/scores, and are listed
 * here instead so the report stays honest about what it couldn't check
 * without shipping a false-confidence finding.
 */
/**
 * Pre-Connection Scan Confidence Tiering PRD §4.3 verdict-lattice
 * discriminant for UnassessableFinding — reclassifies what was previously
 * one undifferentiated bucket fed by four independent producers:
 * clickIdContention.ts/signalConsistency.ts (two independent signals
 * disagree) → 'CONFLICT'; coverageSuppression.ts/degradationSuppression.ts
 * (the crawl didn't reach/settle what this result's evidence depends on) →
 * 'NOT_OBSERVED'. Optional: a producer not yet updated to attach it omits
 * the field rather than guessing.
 */
export type UnassessableKind = 'NOT_OBSERVED' | 'INCONCLUSIVE' | 'CONFLICT';

export interface UnassessableFinding {
  rule_id: string;
  /** The step name (StepCoverage.step) this result's evidence cited. */
  step: string;
  reason: string;
  /** See UnassessableKind. */
  kind?: UnassessableKind;
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §6 — one fired cross-signal
 * consistency assertion (CONF_01–CONF_05, register/signalConsistency.ts).
 * Defined here (not in signalConsistency.ts) so ReportJSON can reference
 * it without a services→types→services import cycle; signalConsistency.ts
 * imports it back from here.
 */
export interface SignalConflict {
  assertion_id: 'CONF_01' | 'CONF_02' | 'CONF_03' | 'CONF_04' | 'CONF_05';
  entity: string;
  source_a: string;
  reading_a: string;
  source_b: string;
  reading_b: string;
  affected_rule_ids: string[];
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §12 — a connected-tier
 * check/module, declared in reporting/withAccessRegistry.ts and rendered
 * in the report's "With access" section (PRD §12.3) only when it resolves
 * a real finding or open question raised *in this run* — never
 * aspirational (§12.1).
 */
export interface WithAccessEntry {
  check: string;
  requires_connection: ('google_ads' | 'meta' | 'tiktok' | 'ga4' | 'linkedin')[];
  /** rule_ids (or open-question text) this entry resolves, when present in this run. */
  answers_question_for: string[];
  /** One line: what the check returns. */
  reveals: string;
}

/**
 * Pre-Connection Scan Confidence Tiering PRD §15 — measured accuracy. Data
 * capture only: nothing computes or publishes an accuracy figure from
 * this yet ("no accuracy figure is published until the sample is
 * meaningful" — explicitly deferred). See
 * supabase/migrations/20260913001_rule_confirmations.sql for the full
 * rationale, including why `finding_id` stays unused today.
 */
export type RuleConfirmationOutcome = 'CONFIRMED' | 'REFUTED' | 'UNKNOWN';
export type RuleConfirmationSource = 'client_answer' | 'rescan' | 'operator';

export interface RuleConfirmation {
  id: string;
  audit_id: string;
  rule_id: string;
  finding_id: string | null;
  outcome: RuleConfirmationOutcome;
  source: RuleConfirmationSource;
  note: string | null;
  created_at: string;
}

export interface ReportJSON {
  audit_id: string;
  website_url: string;
  generated_at: string;
  /** Which rule library produced this report — never compare scores across versions. Absent on reports generated before this field existed; treat as 'v1-legacy'. */
  rule_set_version?: RuleSetVersion;
  /**
   * Check Register version that produced this report's results (Report
   * Correctness Programme PRD Part D4) — register/layers.ts's
   * REGISTER_VERSION at scan time. Bumped on any rule addition, removal,
   * or severity change; two reports with different register_version
   * values are not directly comparable even when both are 'v2'. Undefined
   * for a v1-legacy report (no Check Register involved) or one generated
   * before this field existed.
   */
  register_version?: string;
  executive_summary: {
    overall_status: 'healthy' | 'partially_broken' | 'critical';
    business_summary: string;
    scores: AuditScores;
    coverage?: ReportCoverage;
  };
  journey_stages: JourneyStage[];
  platform_breakdown: PlatformBreakdown[];
  issues: ReportIssue[];
  site_setup: SiteSetupSummary;
  technical_appendix: {
    validation_results: ValidationResult[];
    raw_network_requests: NetworkRequest[];
    raw_datalayer_events: DataLayerEvent[];
  };
  /**
   * Findings suppressed by the fallback_landing cross-reference — see
   * UnassessableFinding. Omitted (not an empty array) when nothing was
   * suppressed, per CLAUDE.md rule 12 (no fabricated UI data): the PDF
   * section only renders when this is present.
   */
  could_not_be_assessed?: UnassessableFinding[];
  /**
   * Report Honesty PRD Part B — configurations whose intent only the client
   * can answer, printed as questions rather than caveated as findings (a
   * second GTM container could be a live migration; an undeclared tag could
   * be a channel ViMi wasn't told about). Built from every fail/warning
   * result whose rule carries `client_question`, plus the bespoke
   * unverified-conversion-surface question (emitted whenever that step's
   * StepCoverage.source is 'heuristic'). Omitted (not an empty array) when
   * there's nothing to ask — the section is dropped entirely rather than
   * rendering an empty heading, per PRD §B3.
   */
  open_questions?: string[];
  /**
   * Pre-Connection Scan Confidence Tiering PRD §6/§11.2 — every conflict
   * signalConsistency.ts's CONF_01–CONF_05 (or clickIdContention.ts) fired
   * this run, for the "Signals in conflict" section: both readings shown,
   * no winner picked. Omitted (not an empty array) when nothing
   * conflicted, matching could_not_be_assessed's convention.
   */
  signal_conflicts?: SignalConflict[];
  /**
   * Pre-Connection Scan Confidence Tiering PRD §12 — the "With access"
   * section: connected-tier checks/modules that would resolve a real
   * finding or open question raised in this run. Built by
   * reporting/withAccessRegistry.ts's buildWithAccessSection(), which
   * filters the static registry down to only entries with something to
   * resolve here. Omitted (not an empty array) when nothing applies.
   */
  with_access?: WithAccessEntry[];
  /**
   * Set by the pre-render placeholder guard (PRD "Signal Health Report"
   * Issue 4) when a narrative field contains literal placeholder-shaped
   * text (an unfilled `{{variable}}`, an illustrative "G-XXXXXXXXXX"-style
   * example string). Non-fatal — the report still ships; the frontend
   * renders a visible warning banner when this is present. Absent (not
   * `false`) when the guard found nothing, so its presence alone is the
   * signal to check.
   */
  content_quality_warning?: {
    flagged_fields: string[];
  };
}

// ─── DB row shapes ────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string;
  // Nullable for a public (no-login) scan — see 20260914001_public_audit_check_register.sql.
  // Ownership for those runs is the public_token below, not user_id.
  user_id: string | null;
  website_url: string;
  funnel_type: FunnelType;
  region: Region;
  status: AuditStatus;
  progress: number;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  browserbase_session_id?: string;
  test_email?: string;
  test_phone?: string;
  client_id?: string | null;
  // Check Register v2 Scan Inputs columns (20260902002_scan_inputs_check_register.sql) — null on rows written before this migration.
  rule_set_version?: RuleSetVersion;
  site_type?: SiteType | null;
  secondary_motion?: SecondaryMotion | null;
  declared_platforms?: DeclaredPlatform[];
  // Pre-Connection Scan Confidence Tiering PRD §8 (20260911002_declaration_source.sql) — null on rows predating this migration; read as 'OPERATOR_ASSUMED' by DECLARED_PLATFORM_HAS_TAG when absent.
  declaration_source?: DeclarationSource | null;
  primary_channel?: DeclaredPlatform | null;
  monthly_spend_band?: string | null;
  traffic_regions?: TrafficRegion[];
  cmp?: CMP | null;
  product_domain?: string | null;
  checkout_domain?: string | null;
  additional_properties?: string[];
  declared_conversions?: DeclaredConversion[] | null;
  // Coverage columns (20260903002_audit_coverage_fingerprint.sql) — null
  // when step_coverage was never captured for this audit. See
  // reporting/coverage.ts's computeCoverageFingerprint.
  coverage_fingerprint?: string | null;
  pages_distinct?: number | null;
  // Score comparability columns (20260906002_score_comparability.sql,
  // Report Correctness Programme PRD Part D3/D4) — null for a v1-legacy
  // audit, or a v2 audit written before this migration. Durable copies of
  // ReportJSON.register_version/conversion_signal_health_numerator/
  // _denominator, so a later audit for the same site can compare its own
  // denominator/register_version against the prior run without unpacking
  // audit_reports.report_json.
  register_version?: string | null;
  conversion_signal_health_numerator?: number | null;
  conversion_signal_health_denominator?: number | null;
  // Settle contract & run quality (Pre-Connection Scan Confidence Tiering
  // PRD §7, 20260911001_settle_contract_run_quality.sql) — null when
  // step_coverage was never captured (same condition as coverage_fingerprint
  // above) or for a run predating this migration. See
  // reporting/coverage.ts's computeRunQuality — the exact same value the
  // report's executive_summary.coverage.run_quality carries, durably copied
  // onto the row so the export route (INSUFFICIENT blocks a client-facing
  // PDF/JSON/zip) can check it without unpacking audit_reports.report_json.
  run_quality?: RunQuality | null;
  // Public (no-login) scan fields — 20260914001_public_audit_check_register.sql.
  is_public?: boolean;
  public_token?: string | null;
  ip_hash?: string | null;
  expires_at?: string | null;
  lead_email?: string | null;
}

/** POST /api/audits/start payload for a Check Register v2 scan. */
export interface StartAuditInputV2 extends ScanInputs {
  url_map: Record<string, string>;
  client_id?: string;
}
