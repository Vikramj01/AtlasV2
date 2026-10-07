/**
 * C.5a rules — "rules on data Atlas already receives" (GA4 Admin / L11 / Junk Gate PRD §C.5a).
 * One pure function per rule; none reads Redis or the DB. Evidence is non-PII by construction:
 * it never contains an address, number, IP or user-agent string — at most an e-mail DOMAIN,
 * which the PRD allows a reviewer to see.
 *
 * `hit: false` results still carry their class, so a caller can enumerate rules uniformly.
 */
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { isDisposableDomain } from './lists/disposableDomains';
import { matchAutomationUserAgent } from './lists/automationUserAgents';
import type { JunkRuleInput, JunkThresholds, RuleResult } from './types';

const NO_HIT = (cls: RuleResult['class']): RuleResult => ({ hit: false, class: cls, evidence: '' });

// ── e-mail helpers ────────────────────────────────────────────────────────────

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:xn--[a-z0-9-]{1,59}|[a-z]{2,24})$/;

export function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.trim().lastIndexOf('@');
  if (at <= 0 || at === email.trim().length - 1) return null;
  const trimmed = email.trim();
  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1).toLowerCase() };
}

/** Syntax plus a domain shape that could have an MX record (≥2 valid labels, alphabetic TLD). No DNS lookup. */
export function isWellFormedEmail(email: string): boolean {
  const parts = splitEmail(email);
  if (!parts) return false;
  const { local, domain } = parts;
  if (local.length === 0 || local.length > 64 || /\s/.test(local) || local.includes('@') || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => LABEL.test(l)) && TLD.test(labels[labels.length - 1]);
}

// ── JC_EMAIL_MALFORMED (hard) ─────────────────────────────────────────────────

export function ruleEmailMalformed(input: JunkRuleInput): RuleResult {
  if (!input.email || input.email.trim() === '') return NO_HIT('hard');
  return isWellFormedEmail(input.email)
    ? NO_HIT('hard')
    : { hit: true, class: 'hard', evidence: 'e-mail address is not well-formed or its domain cannot receive mail' };
}

// ── JC_EMAIL_DISPOSABLE (soft) ────────────────────────────────────────────────

export function ruleEmailDisposable(input: JunkRuleInput): RuleResult {
  if (!input.email) return NO_HIT('soft');
  const parts = splitEmail(input.email);
  if (!parts || !isWellFormedEmail(input.email)) return NO_HIT('soft'); // malformed is the other rule's job
  return isDisposableDomain(parts.domain)
    ? { hit: true, class: 'soft', evidence: `e-mail domain is on the disposable-domain list (${parts.domain})` }
    : NO_HIT('soft');
}

// ── JC_PHONE_INVALID (soft) ───────────────────────────────────────────────────

/** Same digit repeated, or a straight ascending/descending run, of at least 7 digits. */
export function isPatternPhone(digits: string): boolean {
  if (digits.length < 7) return false;
  if (/^(\d)\1+$/.test(digits)) return true;
  let asc = true;
  let desc = true;
  for (let i = 1; i < digits.length; i++) {
    const d = Number(digits[i]) - Number(digits[i - 1]);
    if (d !== 1 && d !== -9) asc = false; // 9→0 wraps
    if (d !== -1 && d !== 9) desc = false;
  }
  return asc || desc;
}

export function rulePhoneInvalid(input: JunkRuleInput): RuleResult {
  if (!input.phone || input.phone.trim() === '') return NO_HIT('soft');
  const digits = input.phone.replace(/\D/g, '');
  if (isPatternPhone(digits)) {
    return { hit: true, class: 'soft', evidence: 'phone number is a repeated or sequential digit pattern' };
  }
  const country = input.country && /^[a-zA-Z]{2}$/.test(input.country) ? (input.country.toUpperCase() as CountryCode) : undefined;
  const parsed = parsePhoneNumberFromString(input.phone, country);
  if (!parsed || !parsed.isValid()) {
    return {
      hit: true,
      class: 'soft',
      evidence: country ? `phone number does not validate for region ${country}` : 'phone number does not validate (no region supplied and no international prefix)',
    };
  }
  return NO_HIT('soft');
}

// ── JC_DUPLICATE_SUBMISSION (soft) ────────────────────────────────────────────

/** Distinct from dedup: dedup catches the SAME event_id; this catches the same person + event under a DIFFERENT event_id. */
export function ruleDuplicateSubmission(input: JunkRuleInput, t: Pick<JunkThresholds, 'duplicate_window_minutes'>): RuleResult {
  return input.duplicateOfEventId
    ? { hit: true, class: 'soft', evidence: `same contact submitted this event again within ${t.duplicate_window_minutes} minutes under a different event id` }
    : NO_HIT('soft');
}

// ── JC_SUBMIT_VELOCITY (soft) ─────────────────────────────────────────────────

export function ruleSubmitVelocity(input: JunkRuleInput, t: Pick<JunkThresholds, 'velocity_max' | 'velocity_window_minutes'>): RuleResult {
  if (input.submissionsFromIp === undefined) return NO_HIT('soft');
  return input.submissionsFromIp > t.velocity_max
    ? { hit: true, class: 'soft', evidence: `more than ${t.velocity_max} submissions of this event from one address within ${t.velocity_window_minutes} minutes` }
    : NO_HIT('soft');
}

// ── JC_NON_HUMAN_UA (hard) ────────────────────────────────────────────────────

export function ruleNonHumanUa(input: JunkRuleInput): RuleResult {
  if (!input.userAgent) return NO_HIT('hard');
  const sig = matchAutomationUserAgent(input.userAgent);
  return sig
    ? { hit: true, class: 'hard', evidence: `user agent matches the automation signature "${sig}"` }
    : NO_HIT('hard');
}

// ── JC_TEST_VALUES (soft) ─────────────────────────────────────────────────────

export const TEST_VALUES: ReadonlySet<string> = new Set([
  'test', 'tester', 'testing', 'testtest', 'asdf', 'asdfgh', 'asdfghjkl', 'qwerty', 'qwe', 'qwert', 'abc', 'abcd', 'abcde',
  'aaa', 'aaaa', 'xxx', 'xxxx', 'zzz', 'foo', 'bar', 'foobar', 'fake', 'dummy', 'sample', 'demo', 'none', 'null', 'nobody',
  'noname', 'noone', 'na', 'nil', 'lorem', 'ipsum', 'johndoe', 'janedoe',
]);

/** Letters only, lower-case, "+tag" and digits dropped: "Test.User+1@x" → "testuser"; "test123@x" → "test". */
function letters(s: string): string {
  return s.toLowerCase().replace(/\+.*$/, '').replace(/[^a-z]/g, '');
}

export function ruleTestValues(input: JunkRuleInput): RuleResult {
  const fields: Array<[string, string | undefined]> = [
    ['first name', input.firstName],
    ['last name', input.lastName],
    ['e-mail local part', input.email ? splitEmail(input.email)?.local : undefined],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    const normalised = letters(value);
    if (normalised.length > 0 && TEST_VALUES.has(normalised)) {
      return { hit: true, class: 'soft', evidence: `${label} is an obvious test value` };
    }
  }
  return NO_HIT('soft');
}
