/**
 * Step URL Resolver — Site Evaluation Coverage & Honesty PRD, Phase 2 (§7).
 *
 * From a bare URL, resolves the journey template's step keys (product,
 * checkout, confirmation, ...) to real pages, with provenance, inside a
 * bounded budget — run by the orchestrator before simulateJourney. Never
 * overrides a user-supplied url_map entry; only fills gaps.
 *
 * Four strategies, cheapest first, short-circuiting once every missing key
 * is filled:
 *   1. robots.txt → Sitemap: directives
 *   2. sitemap.xml (+ one level of sitemap-index recursion)
 *   3. Landing-page link harvest (same-origin <a href> from the landing
 *      page's HTML)
 *   4. Path heuristics (crawl/pageDiscovery.ts's FUNNEL_PATH_HEURISTICS),
 *      verified with a HEAD request before accepting
 *
 * All four run as plain fetch() calls — no Playwright/browser session.
 * The resolver runs before simulateJourney ever opens one, so there is no
 * "already-open landing page" to read a live DOM from yet; a raw HTML
 * fetch + href regex gets the same same-origin-link signal at a fraction
 * of the cost, and keeps this module fully unit-testable by stubbing
 * global fetch (same convention as journeySimulator.ts's
 * probeDomainReachable) rather than mocking a browser.
 *
 * Every candidate URL passes the existing SSRF validator (urlValidator.ts)
 * before any fetch — the same code path that protects POST /start.
 */
import type { StepUrlSource } from '@/types/audit';
import { validateUrl } from '@/utils/urlValidator';
import { hostnameOf } from './journeySimulator';
import { FUNNEL_PATH_HEURISTICS } from '@/services/crawl/pageDiscovery';
import logger from '@/utils/logger';

const MAX_FETCHES = 25;
const MAX_WALL_MS = 15_000;
const PER_REQUEST_TIMEOUT_MS = 5_000;

/** Per-step-key keyword table used to score a discovered candidate URL — same list across strategies 2-4. A path must contain at least one keyword to be assignable; §15.3's "minimum candidate score" guard against a confidently-wrong low-quality match. */
const STEP_KEYWORDS: Record<string, string[]> = {
  product: ['/product', '/p/', '/shop', '/item'],
  checkout: ['/checkout', '/cart', '/basket'],
  confirmation: ['/thank-you', '/thankyou', '/order-confirmation', '/order-confirmed', '/confirmation', '/success'],
  signup: ['/signup', '/sign-up', '/register', '/join', '/trial', '/start', '/demo'],
  onboarding: ['/onboarding', '/welcome', '/get-started', '/setup'],
  thank_you: ['/thank-you', '/thankyou', '/success', '/confirmation'],
};

export type ResolvedStepUrlSource = Extract<StepUrlSource, 'sitemap' | 'nav_link' | 'heuristic'>;

export interface ResolvedStepUrl {
  url: string;
  source: ResolvedStepUrlSource;
}

export interface StepUrlResolverOptions {
  website_url: string;
  /** Every step key the funnel template needs, including 'landing' — 'landing' is always skipped (it's never a discovery target; it either has a user-supplied URL or falls back to website_url). */
  step_keys: string[];
  /** The caller's existing url_map — an entry present here is never overridden, whether or not it's a real page. */
  url_map: Record<string, string>;
  /** Scan Input domains — a candidate on one of these hosts is accepted even though it's cross-origin from website_url. */
  product_domain?: string;
  checkout_domain?: string;
}

interface Candidate {
  url: string;
  source: ResolvedStepUrlSource;
}

/**
 * Tracks the fetch/time budget across every strategy and performs the
 * actual SSRF-validated, timed, never-throwing fetch. Shared mutable state
 * deliberately lives on one object passed through the strategies rather
 * than module-level globals, so concurrent resolveStepUrls() calls (two
 * audits running at once) never share budget with each other.
 */
class Budget {
  private fetchCount = 0;
  private readonly deadline: number;

  constructor() {
    this.deadline = Date.now() + MAX_WALL_MS;
  }

  private hasRoom(): boolean {
    return this.fetchCount < MAX_FETCHES && Date.now() < this.deadline;
  }

  /** SSRF-validates, checks budget, fetches with a per-request timeout. Returns undefined on any failure, budget exhaustion, or invalid URL — never throws. */
  async fetch(url: string, opts: { method?: 'GET' | 'HEAD' } = {}): Promise<{ ok: boolean; text?: string } | undefined> {
    if (!this.hasRoom()) return undefined;
    if (!validateUrl(url).valid) return undefined;

    this.fetchCount += 1;
    const controller = new AbortController();
    const remaining = Math.max(0, this.deadline - Date.now());
    const timeoutMs = Math.min(PER_REQUEST_TIMEOUT_MS, remaining);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: opts.method ?? 'GET', signal: controller.signal, redirect: 'follow' });
      const text = opts.method === 'HEAD' ? undefined : await res.text().catch(() => undefined);
      return { ok: res.ok, text };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Strategy 1+2: robots.txt → sitemap.xml (+ one level of index recursion) ──

function extractSitemapUrlsFromRobots(robotsTxt: string): string[] {
  const matches = [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)];
  return matches.map((m) => m[1]);
}

function extractLocsFromSitemapXml(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function discoverViaSitemap(origin: string, budget: Budget): Promise<Candidate[]> {
  const robotsRes = await budget.fetch(`${origin}/robots.txt`);
  const sitemapUrls = robotsRes?.ok && robotsRes.text
    ? extractSitemapUrlsFromRobots(robotsRes.text)
    : [];

  const toFetch = sitemapUrls.length > 0 ? sitemapUrls : [`${origin}/sitemap.xml`];
  const candidates: Candidate[] = [];

  for (const sitemapUrl of toFetch) {
    const res = await budget.fetch(sitemapUrl);
    if (!res?.ok || !res.text) continue;

    if (isSitemapIndex(res.text)) {
      // One level of recursion only — fetch each sub-sitemap's own <loc>
      // entries as pages, but never recurse into a sub-sitemap that is
      // itself an index.
      const subSitemaps = extractLocsFromSitemapXml(res.text);
      for (const sub of subSitemaps) {
        const subRes = await budget.fetch(sub);
        if (!subRes?.ok || !subRes.text) continue;
        for (const loc of extractLocsFromSitemapXml(subRes.text)) {
          candidates.push({ url: loc, source: 'sitemap' });
        }
      }
    } else {
      for (const loc of extractLocsFromSitemapXml(res.text)) {
        candidates.push({ url: loc, source: 'sitemap' });
      }
    }
  }

  return candidates;
}

// ── Strategy 3: landing-page link harvest ─────────────────────────────────

function extractHrefsFromHtml(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

async function discoverViaLandingLinks(landingUrl: string, budget: Budget): Promise<Candidate[]> {
  const res = await budget.fetch(landingUrl);
  if (!res?.ok || !res.text) return [];

  const candidates: Candidate[] = [];
  for (const href of extractHrefsFromHtml(res.text)) {
    try {
      const resolved = new URL(href, landingUrl).toString();
      candidates.push({ url: resolved, source: 'nav_link' });
    } catch {
      // Unparseable href (mailto:, javascript:void(0), etc.) — skip
    }
  }
  return candidates;
}

// ── Strategy 4: path heuristics, HEAD-verified ────────────────────────────

async function discoverViaPathHeuristics(origin: string, budget: Budget): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const path of FUNNEL_PATH_HEURISTICS) {
    const url = `${origin}${path}`;
    const res = await budget.fetch(url, { method: 'HEAD' });
    if (res?.ok) candidates.push({ url, source: 'heuristic' });
  }
  return candidates;
}

// ── Scoring + assignment ───────────────────────────────────────────────────

function candidateScore(candidateUrl: string, stepKey: string): number {
  const keywords = STEP_KEYWORDS[stepKey];
  if (!keywords) return 0;
  let path: string;
  try {
    path = new URL(candidateUrl).pathname.toLowerCase();
  } catch {
    return 0;
  }
  return keywords.filter((kw) => path.includes(kw)).length;
}

function isAcceptableOrigin(
  candidateUrl: string,
  websiteHost: string | undefined,
  productDomainHost: string | undefined,
  checkoutDomainHost: string | undefined,
): boolean {
  const host = hostnameOf(candidateUrl);
  if (!host) return false;
  return host === websiteHost || host === productDomainHost || host === checkoutDomainHost;
}

/**
 * Assigns the best candidate to each still-missing step key. A candidate
 * already assigned to one key is not reused for another. Highest score
 * wins; ties break on shortest path (§7's tie-break rule) — a shorter path
 * is a weaker but safer guess than a long, more specific-looking one that
 * might be a sibling/unrelated page sharing the same keyword.
 */
function assign(
  missingKeys: string[],
  rawCandidates: Candidate[],
  resolved: Record<string, ResolvedStepUrl>,
): void {
  // SSRF-validate every candidate before it can ever be assigned — strategies
  // 1-3 discover candidate URLs (sitemap <loc> entries, harvested hrefs)
  // without independently fetching each one, so this is the only point in
  // the pipeline that would otherwise catch one before it flows into
  // url_map and gets navigated to by simulateJourney. Non-negotiable, same
  // as the check POST /start already applies to every user-supplied URL.
  const candidates = rawCandidates.filter((c) => validateUrl(c.url).valid);

  const used = new Set<string>();
  for (const key of missingKeys) {
    if (resolved[key]) continue;
    let best: Candidate | undefined;
    let bestScore = 0;
    for (const c of candidates) {
      if (used.has(c.url)) continue;
      const score = candidateScore(c.url, key);
      if (score === 0) continue;
      if (
        score > bestScore ||
        (score === bestScore && best && new URL(c.url).pathname.length < new URL(best.url).pathname.length)
      ) {
        best = c;
        bestScore = score;
      }
    }
    if (best) {
      resolved[key] = { url: best.url, source: best.source };
      used.add(best.url);
    }
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

export async function resolveStepUrls(opts: StepUrlResolverOptions): Promise<Record<string, ResolvedStepUrl>> {
  const missingKeys = opts.step_keys.filter((k) => k !== 'landing' && !opts.url_map[k]);
  const resolved: Record<string, ResolvedStepUrl> = {};
  if (missingKeys.length === 0) return resolved;

  if (!validateUrl(opts.website_url).valid) return resolved;

  const websiteHost = hostnameOf(opts.website_url);
  const productDomainHost = opts.product_domain ? hostnameOf(opts.product_domain) : undefined;
  const checkoutDomainHost = opts.checkout_domain ? hostnameOf(opts.checkout_domain) : undefined;
  const landingUrl = opts.url_map['landing'] ?? opts.website_url;

  let origin: string;
  try {
    origin = new URL(opts.website_url).origin;
  } catch {
    return resolved;
  }

  const budget = new Budget();
  const stillMissing = () => missingKeys.filter((k) => !resolved[k]);

  try {
    // Strategy 1+2: robots.txt → sitemap.xml
    const sitemapCandidates = await discoverViaSitemap(origin, budget);
    assign(
      stillMissing(),
      sitemapCandidates.filter((c) => isAcceptableOrigin(c.url, websiteHost, productDomainHost, checkoutDomainHost)),
      resolved,
    );
    if (stillMissing().length === 0) return resolved;

    // Strategy 3: landing-page link harvest
    const linkCandidates = await discoverViaLandingLinks(landingUrl, budget);
    assign(
      stillMissing(),
      linkCandidates.filter((c) => isAcceptableOrigin(c.url, websiteHost, productDomainHost, checkoutDomainHost)),
      resolved,
    );
    if (stillMissing().length === 0) return resolved;

    // Strategy 4: path heuristics, HEAD-verified
    const heuristicCandidates = await discoverViaPathHeuristics(origin, budget);
    assign(stillMissing(), heuristicCandidates, resolved); // origin-derived — already same-origin by construction

    return resolved;
  } catch (err) {
    // Never let discovery failure abort the audit — an unresolved key
    // simply stays fallback_landing, same as if the resolver had never run.
    logger.warn({ website_url: opts.website_url, err: err instanceof Error ? err.message : String(err) }, 'Step URL resolution failed partway through');
    return resolved;
  }
}
