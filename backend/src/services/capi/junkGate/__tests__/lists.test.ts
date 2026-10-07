/** Vendored lists carry their provenance and are well-formed (PRD §C.5: source note, version, licence). */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DISPOSABLE_EMAIL_DOMAINS, DISPOSABLE_DOMAINS_VERSION, isDisposableDomain } from '../lists/disposableDomains';
import { AUTOMATION_UA_SIGNATURES, AUTOMATION_UA_VERSION, matchAutomationUserAgent } from '../lists/automationUserAgents';

const read = (f: string) => readFileSync(join(__dirname, '../lists', f), 'utf8');

describe('disposable-domain list', () => {
  it('is a real vendored list, versioned, with source and licence in the header', () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.size).toBeGreaterThan(5000);
    expect(DISPOSABLE_DOMAINS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
    const header = read('disposableDomains.ts').split('export const')[0];
    expect(header).toContain('github.com/disposable-email-domains/disposable-email-domains');
    expect(header).toContain('CC0 1.0');
    expect(header).toContain('REFRESH');
    expect(DISPOSABLE_DOMAINS_VERSION.endsWith(`-${DISPOSABLE_EMAIL_DOMAINS.size}`)).toBe(true);
  });

  it('every entry is a lowercase hostname', () => {
    for (const d of DISPOSABLE_EMAIL_DOMAINS) expect(d).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
  });

  it('knows well-known disposable providers and matches their subdomains, but not their lookalikes', () => {
    expect(isDisposableDomain('mailinator.com')).toBe(true);
    expect(isDisposableDomain('MAILINATOR.COM')).toBe(true);
    expect(isDisposableDomain('x.y.mailinator.com')).toBe(true);
    expect(isDisposableDomain('xmailinator.example')).toBe(false); // a lookalike that is not itself listed
    expect(isDisposableDomain('gmail.com')).toBe(false);
    expect(isDisposableDomain('com')).toBe(false);
  });

  it('nothing fetches the list at runtime', () => {
    expect(read('disposableDomains.ts')).not.toMatch(/\bfetch\(|https?\.get|axios/);
  });
});

describe('automation user-agent list', () => {
  it('is versioned and every signature is lowercase and non-trivial', () => {
    expect(AUTOMATION_UA_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
    for (const s of AUTOMATION_UA_SIGNATURES) {
      expect(s).toBe(s.toLowerCase());
      expect(s.length).toBeGreaterThanOrEqual(4);
    }
    expect(new Set(AUTOMATION_UA_SIGNATURES).size).toBe(AUTOMATION_UA_SIGNATURES.length);
  });
  it('has no signature broad enough to match a mainstream browser', () => {
    const browsers = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]',
    ];
    for (const ua of browsers) expect(matchAutomationUserAgent(ua), ua).toBeNull();
  });
});
