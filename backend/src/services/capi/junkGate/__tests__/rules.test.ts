/**
 * C.5a rules (GA4 Admin / L11 / Junk Gate PRD §C.5a, AC 2): every rule has fire and no-fire
 * cases, and JC_DUPLICATE_SUBMISSION is proven distinct from event_id dedup. Evidence is
 * asserted non-PII throughout.
 */
import { describe, it, expect } from 'vitest';
import {
  ruleEmailMalformed, ruleEmailDisposable, rulePhoneInvalid, ruleDuplicateSubmission, ruleSubmitVelocity,
  ruleNonHumanUa, ruleTestValues, isWellFormedEmail, isPatternPhone, ruleHoneypotFilled, ruleSubmitTooFast,
} from '../rules';

const SECRET_EMAIL = 'jane.visitor@mailinator.com';
const SECRET_PHONE = '+44 20 7946 0958';
const SECRET_IP = '203.0.113.77';
const SECRET_UA = 'Mozilla/5.0 HeadlessChrome/120.0';

describe('JC_EMAIL_MALFORMED (hard)', () => {
  it.each(['not-an-email', 'a@b', 'a@@b.com', '@x.com', 'a@', 'a b@x.com', 'a@x..com', '.a@x.com', 'a.@x.com', 'a@-x.com', 'a@x.c', 'a@x.123', 'a@x_y.com'])('fires on %s', (email) => {
    const r = ruleEmailMalformed({ email });
    expect(r.hit).toBe(true);
    expect(r.class).toBe('hard');
  });

  it.each(['jane@example.com', 'jane.doe+tag@sub.example.co.uk', 'j@xn--bcher-kva.example', 'a@b.io'])('does not fire on %s', (email) => {
    expect(ruleEmailMalformed({ email }).hit).toBe(false);
  });

  it('does not fire when there is no e-mail at all', () => {
    expect(ruleEmailMalformed({}).hit).toBe(false);
    expect(ruleEmailMalformed({ email: '  ' }).hit).toBe(false);
  });

  it('rejects an over-long local part', () => {
    expect(isWellFormedEmail(`${'a'.repeat(65)}@example.com`)).toBe(false);
    expect(isWellFormedEmail(`${'a'.repeat(64)}@example.com`)).toBe(true);
  });
});

describe('JC_EMAIL_DISPOSABLE (soft)', () => {
  it('fires on a listed domain and names only the domain', () => {
    const r = ruleEmailDisposable({ email: SECRET_EMAIL });
    expect(r.hit).toBe(true);
    expect(r.class).toBe('soft');
    expect(r.evidence).toContain('mailinator.com');
    expect(r.evidence).not.toContain('jane');
  });
  it('matches a subdomain of a listed domain', () => {
    expect(ruleEmailDisposable({ email: 'x@abc.mailinator.com' }).hit).toBe(true);
  });
  it('does not fire on a normal domain, a malformed address, or none', () => {
    expect(ruleEmailDisposable({ email: 'jane@gmail.com' }).hit).toBe(false);
    expect(ruleEmailDisposable({ email: 'jane@acme.co.uk' }).hit).toBe(false);
    expect(ruleEmailDisposable({ email: 'nonsense' }).hit).toBe(false);
    expect(ruleEmailDisposable({}).hit).toBe(false);
  });
});

describe('JC_PHONE_INVALID (soft)', () => {
  it('does not fire on a valid number for its region, or with an international prefix', () => {
    expect(rulePhoneInvalid({ phone: '020 7946 0958', country: 'GB' }).hit).toBe(false);
    expect(rulePhoneInvalid({ phone: '+44 20 7946 0958' }).hit).toBe(false);
    expect(rulePhoneInvalid({ phone: '(415) 555-2671', country: 'us' }).hit).toBe(false);
  });
  it('fires when the number does not validate for the region', () => {
    const r = rulePhoneInvalid({ phone: '12345', country: 'GB' });
    expect(r.hit).toBe(true);
    expect(r.class).toBe('soft');
    expect(r.evidence).toContain('GB');
  });
  it('fires with no region and no international prefix, saying so', () => {
    const r = rulePhoneInvalid({ phone: '07911 123456' });
    expect(r.hit).toBe(true);
    expect(r.evidence).toContain('no region');
  });
  it.each(['0000000000', '1111111', '1234567890', '9876543210', '+1 234 567 8901'])('fires on the pattern %s', (phone) => {
    expect(rulePhoneInvalid({ phone, country: 'US' }).hit).toBe(true);
  });
  it('isPatternPhone ignores short numbers and wraps 9→0', () => {
    expect(isPatternPhone('123456')).toBe(false);
    expect(isPatternPhone('7890123')).toBe(true);
    expect(isPatternPhone('4155552671')).toBe(false);
  });
  it('does not fire when there is no phone', () => {
    expect(rulePhoneInvalid({}).hit).toBe(false);
  });
});

describe('JC_DUPLICATE_SUBMISSION (soft) — distinct from event_id dedup', () => {
  it('fires when an EARLIER, DIFFERENT event id carries the same contact + event name', () => {
    const r = ruleDuplicateSubmission({ duplicateOfEventId: 'evt-earlier' }, { duplicate_window_minutes: 10 });
    expect(r.hit).toBe(true);
    expect(r.class).toBe('soft');
    expect(r.evidence).toContain('10 minutes');
    expect(r.evidence).toContain('different event id');
  });
  it('does not fire without an earlier different event', () => {
    expect(ruleDuplicateSubmission({}, { duplicate_window_minutes: 10 }).hit).toBe(false);
    expect(ruleDuplicateSubmission({ duplicateOfEventId: null }, { duplicate_window_minutes: 10 }).hit).toBe(false);
  });
});

describe('JC_SUBMIT_VELOCITY (soft)', () => {
  const t = { velocity_max: 5, velocity_window_minutes: 60 };
  it('fires strictly above the max, not at it', () => {
    expect(ruleSubmitVelocity({ submissionsFromIp: 6 }, t).hit).toBe(true);
    expect(ruleSubmitVelocity({ submissionsFromIp: 5 }, t).hit).toBe(false);
  });
  it('cannot fire without an address to count', () => {
    expect(ruleSubmitVelocity({}, t).hit).toBe(false);
  });
  it('honours a per-client threshold', () => {
    expect(ruleSubmitVelocity({ submissionsFromIp: 3 }, { velocity_max: 2, velocity_window_minutes: 30 }).hit).toBe(true);
  });
});

describe('JC_NON_HUMAN_UA (hard)', () => {
  it.each([
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    'python-requests/2.31.0', 'curl/8.4.0', 'Go-http-client/2.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Puppeteer', 'Mozilla/5.0 Playwright/1.40',
  ])('fires on %s', (userAgent) => {
    const r = ruleNonHumanUa({ userAgent });
    expect(r.hit).toBe(true);
    expect(r.class).toBe('hard');
  });
  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; Cubot X70) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  ])('does not fire on a real browser: %s', (userAgent) => {
    expect(ruleNonHumanUa({ userAgent }).hit).toBe(false);
  });
  it('cannot fire without a user agent', () => {
    expect(ruleNonHumanUa({}).hit).toBe(false);
  });
});

describe('JC_TEST_VALUES (soft)', () => {
  it.each([
    [{ firstName: 'test' }, 'first name'], [{ lastName: 'ASDF' }, 'last name'], [{ firstName: 'Qwerty' }, 'first name'],
    [{ email: 'test@example.com' }, 'e-mail local part'], [{ email: 'Test.123+x@example.com' }, 'e-mail local part'], [{ email: 'asdf1@example.com' }, 'e-mail local part'],
  ])('fires on %j', (input, label) => {
    const r = ruleTestValues(input);
    expect(r.hit).toBe(true);
    expect(r.evidence).toContain(label as string);
  });
  it.each([
    { firstName: 'Jane', lastName: 'Visitor' }, { email: 'jane.visitor@example.com' }, { firstName: 'Testa' }, { email: 'contest@example.com' }, {},
  ])('does not fire on %j', (input) => {
    expect(ruleTestValues(input).hit).toBe(false);
  });
});

describe('evidence never carries the contact data the rules read', () => {
  it('no rule leaks an address, number, IP or user agent', () => {
    const all = [
      ruleEmailMalformed({ email: 'bad-address-1234' }),
      ruleEmailDisposable({ email: SECRET_EMAIL }),
      rulePhoneInvalid({ phone: SECRET_PHONE.replace('20', '99'), country: 'GB' }),
      rulePhoneInvalid({ phone: '1234567890' }),
      ruleDuplicateSubmission({ duplicateOfEventId: 'x' }, { duplicate_window_minutes: 10 }),
      ruleSubmitVelocity({ submissionsFromIp: 99 }, { velocity_max: 5, velocity_window_minutes: 60 }),
      ruleNonHumanUa({ userAgent: SECRET_UA }),
      ruleTestValues({ firstName: 'test', email: 'jane.visitor@example.com' }),
    ];
    for (const r of all) {
      expect(r.hit).toBe(true);
      for (const secret of ['jane.visitor', '7946', SECRET_IP, 'Mozilla', '120.0', '1234567890', 'bad-address-1234']) {
        expect(r.evidence).not.toContain(secret);
      }
    }
  });
});


describe('C3 — JC_HONEYPOT_FILLED (hard)', () => {
  it('fires only when the capture said a mapped honeypot was filled', () => {
    expect(ruleHoneypotFilled({ honeypotFilled: true })).toMatchObject({ hit: true, class: 'hard' });
    expect(ruleHoneypotFilled({ honeypotFilled: true }).evidence).toBe('a honeypot field on the form was filled in');
  });
  it('does not fire when absent, false, or unmapped (Atlas never injects a field)', () => {
    expect(ruleHoneypotFilled({}).hit).toBe(false);
    expect(ruleHoneypotFilled({ honeypotFilled: false }).hit).toBe(false);
  });
});

describe('C3 — JC_SUBMIT_TOO_FAST (hard)', () => {
  const t = { min_submit_ms: 2000 };
  it('fires under the threshold, with non-PII evidence in seconds', () => {
    const r = ruleSubmitTooFast({ msToSubmit: 1200 }, t);
    expect(r).toMatchObject({ hit: true, class: 'hard', evidence: 'submitted 1.2s after first interaction' });
    expect(ruleSubmitTooFast({ msToSubmit: 0 }, t).hit).toBe(true);
    expect(ruleSubmitTooFast({ msToSubmit: 1999 }, t).hit).toBe(true);
  });
  it('does not fire at or over the threshold', () => {
    expect(ruleSubmitTooFast({ msToSubmit: 2000 }, t).hit).toBe(false);
    expect(ruleSubmitTooFast({ msToSubmit: 45_000 }, t).hit).toBe(false);
  });
  it('never fires on a missing or nonsensical measurement', () => {
    for (const ms of [undefined, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(ruleSubmitTooFast({ msToSubmit: ms as number | undefined }, t).hit).toBe(false);
  });
  it('honours a configured threshold', () => {
    expect(ruleSubmitTooFast({ msToSubmit: 3000 }, { min_submit_ms: 5000 }).hit).toBe(true);
    expect(ruleSubmitTooFast({ msToSubmit: 1000 }, { min_submit_ms: 500 }).hit).toBe(false);
  });
});
