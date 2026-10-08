/**
 * Junk conversion gate types (GA4 Admin / L11 / Junk Gate PRD Part C). v1 is deterministic
 * rules only — no third-party bot scoring, no CRM signal (PRD §C.2).
 */
export const JUNK_RULE_IDS = [
  'JC_EMAIL_MALFORMED',
  'JC_EMAIL_DISPOSABLE',
  'JC_PHONE_INVALID',
  'JC_DUPLICATE_SUBMISSION',
  'JC_SUBMIT_VELOCITY',
  'JC_NON_HUMAN_UA',
  'JC_TEST_VALUES',
  // C3 — need capture beyond data Atlas already receives (PRD §C.5b).
  'JC_HONEYPOT_FILLED',
  'JC_SUBMIT_TOO_FAST',
] as const;
export type JunkRuleId = (typeof JUNK_RULE_IDS)[number];

export type JunkRuleClass = 'hard' | 'soft';
export type JunkVerdict = 'junk' | 'suspect' | 'clean';

/** What a rule returns. `evidence` is non-PII: a rule id's reason and, at most, an e-mail DOMAIN. */
export interface RuleResult {
  hit: boolean;
  class: JunkRuleClass;
  evidence: string;
}

export interface RuleHit {
  rule_id: JunkRuleId;
  class: JunkRuleClass;
  evidence: string;
}

export interface JunkThresholds {
  /** JC_DUPLICATE_SUBMISSION window. */
  duplicate_window_minutes: number;
  /** JC_SUBMIT_VELOCITY: more than this many submissions of the same event from one IP … */
  velocity_max: number;
  /** … within this window. */
  velocity_window_minutes: number;
  /** Soft hits needed for `suspect`. */
  suspect_soft_hits: number;
  /** JC_SUBMIT_TOO_FAST: fires when first interaction → submit is shorter than this (ms). */
  min_submit_ms: number;
}

export const DEFAULT_THRESHOLDS: JunkThresholds = {
  duplicate_window_minutes: 10,
  velocity_max: 5,
  velocity_window_minutes: 60,
  suspect_soft_hits: 2,
  min_submit_ms: 2000,
};

export type JunkGateMode = 'off' | 'observe' | 'enforce';
export type JunkAction = 'hold' | 'drop' | 'send';
export type TimeoutAction = 'release' | 'drop';

export interface JunkGateConfig {
  mode: JunkGateMode;
  /** Events in scope. Empty = the default lead-type set (see config.ts). */
  event_names: string[];
  /** Per-rule enable flags; an absent rule is enabled. */
  rule_flags: Partial<Record<JunkRuleId, boolean>>;
  thresholds: JunkThresholds;
  /** Enforce mode only (C2): what happens to a `junk` / `suspect` verdict. */
  action_junk: JunkAction;
  action_suspect: JunkAction;
  /** Requested hold length; clamped per destination window (holdWindows.ts). */
  hold_timeout_hours: number;
  /** What an unreviewed hold becomes at expiry. Default `release` (fail open). */
  timeout_action: TimeoutAction;
  /** C3: DQM alert when the flagged share of the last 24h exceeds this percent (≥ 20 evaluated). */
  hold_rate_alert_pct: number;
}

/**
 * Everything the rules read, with stateful signals ALREADY resolved by the caller
 * ("resolve outside, read inside" — the rules stay pure and synchronous).
 */
export interface JunkRuleInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** ISO 3166-1 alpha-2, used as the phone default region. */
  country?: string;
  userAgent?: string;
  /** Event id of an EARLIER different event with the same hashed identity + event name inside the window; null/undefined = none. */
  duplicateOfEventId?: string | null;
  /** Submissions of this event from this IP in the velocity window, INCLUDING this one; undefined = no IP to count. */
  submissionsFromIp?: number;
  /** C3: a mapped honeypot field held any value. Only the boolean is ever carried, never the value. */
  honeypotFilled?: boolean;
  /** C3: milliseconds from first form interaction to submit, as captured in the browser. */
  msToSubmit?: number;
}
