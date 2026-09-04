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
  | 'pinterest';

/** Regions field granularity the consent layer (L8) needs — distinct from the legacy `Region` (us/eu/global). */
export type TrafficRegion = 'eea' | 'uk' | 'switzerland' | 'brazil' | 'us' | 'other';

export type CMP = 'onetrust' | 'cookiebot' | 'usercentrics' | 'custom' | 'none';

export interface DeclaredConversion {
  name: string;
  kind: 'primary' | 'secondary';
}

/** The four Scan Inputs collected before a Check Register v2 scan runs, plus the optional unlocks. */
export interface ScanInputs {
  // 1. Site type
  site_type: SiteType;
  secondary_motion?: SecondaryMotion;
  // 2. Ad platforms
  declared_platforms: DeclaredPlatform[];
  primary_channel: DeclaredPlatform;
  monthly_spend_band?: string;
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

/** A browser console error or uncaught exception observed during a step — see dataCapture.ts's interceptConsoleErrors. */
export interface ConsoleError {
  message: string;
  step: string;
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
  | 'microsoft_uet';

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
}

// ─── Scores ───────────────────────────────────────────────────────────────────

export interface AuditScores {
  conversion_signal_health: number;
  attribution_risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  optimization_strength: 'Weak' | 'Moderate' | 'Strong';
  data_consistency_score: 'Low' | 'Medium' | 'High';
}

// ─── Report coverage (Site Evaluation Coverage & Honesty PRD §6.4) ───────────

export interface CoverageLayerNotTested {
  layer: ValidationLayerV2;
  label: string;
  reason: string;
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

export interface ReportJSON {
  audit_id: string;
  website_url: string;
  generated_at: string;
  /** Which rule library produced this report — never compare scores across versions. Absent on reports generated before this field existed; treat as 'v1-legacy'. */
  rule_set_version?: RuleSetVersion;
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
  user_id: string;
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
}

/** POST /api/audits/start payload for a Check Register v2 scan. */
export interface StartAuditInputV2 extends ScanInputs {
  url_map: Record<string, string>;
  client_id?: string;
}
