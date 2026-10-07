/**
 * Automation / headless user-agent signatures (Junk conversion gate, PRD §C.5 JC_NON_HUMAN_UA).
 *
 * VENDORED and authored in-repo — there is no third-party list here, so no licence applies.
 * Each entry is a case-insensitive SUBSTRING of a user-agent string that no real visitor's
 * browser sends: headless/automation browsers, scripted HTTP clients, and declared crawlers.
 * A declared crawler is not a lead, so it counts as non-human too.
 *
 * Deliberately NOT included: generic substrings that appear in real browsers or in-app
 * webviews ("bot" alone matches e.g. "Cubot" devices; "Mobile", "Safari", "Chrome").
 *
 * Version: 2026-10-07-1.
 * REFRESH (manual): add a signature only with a real-world user-agent that evidences it, bump
 * the version, and add a fire case for it in `junkGate/__tests__/rules.test.ts`.
 */
export const AUTOMATION_UA_VERSION = '2026-10-07-1';

export const AUTOMATION_UA_SIGNATURES: readonly string[] = [
  // Headless / automation browsers
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver', 'slimerjs', 'nightmare', 'cypress',
  // Scripted HTTP clients
  'python-requests', 'python-urllib', 'aiohttp', 'httpx', 'curl/', 'wget/', 'go-http-client', 'java/', 'okhttp', 'apache-httpclient',
  'libwww-perl', 'node-fetch', 'axios/', 'got (', 'undici', 'postmanruntime', 'insomnia/', 'httpie', 'scrapy', 'mechanize',
  // Declared crawlers / monitors
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider', 'yandexbot', 'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot',
  'petalbot', 'facebookexternalhit', 'twitterbot', 'linkedinbot', 'uptimerobot', 'pingdom', 'gtmetrix', 'lighthouse',
];

export function matchAutomationUserAgent(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  return AUTOMATION_UA_SIGNATURES.find((sig) => ua.includes(sig)) ?? null;
}
