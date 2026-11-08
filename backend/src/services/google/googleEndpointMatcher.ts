/**
 * Google endpoint matcher — pure, no I/O.
 * PRD: docs/prd/google-tag-gateway.md §4.
 *
 * Google tags are not always loaded from Google hostnames: with Google tag
 * gateway (GTG) the GTM container, the Google tag and some measurement hits are
 * served from a reserved path on the advertiser's own domain, and a custom-domain
 * sGTM serves them from a subdomain. Detecting Google by hostname therefore
 * reads a correctly deployed gateway as "tag missing".
 *
 * This module classifies a request by its SHAPE (path + query), then decides
 * the transport (who served it). Every Atlas detector that used to look for
 * `googletagmanager.com/...` calls this instead.
 *
 * UNVERIFIED (PRD §13, to be checked against live GTG captures before this
 * reaches a client): whether a `/g/collect` hit keeps its suffix under the
 * reserved path, which `pagead` requests move first-party, and whether the
 * bare `/{path}/` gtag load carries a tag ID. The shape rules below are
 * deliberately host-agnostic so they hold whichever hits move.
 */

export type GoogleRequestKind =
  | 'gtm_container_load' // gtm.js, any origin
  | 'google_tag_load' // gtag/js, any origin
  | 'ga4_hit' // /g/collect, /mp/collect
  | 'ads_hit' // /pagead/(1p-)?(conversion|viewthroughconversion|user-list)/
  | 'other';

export type GoogleTransport =
  | 'google_direct' // Google-owned hostname
  | 'gtg' // same-site host, reserved path, no sGTM signature
  | 'sgtm' // known sGTM endpoint for this client, or sGTM signature
  | 'unknown_first_party' // same-site but cannot tell GTG from sGTM
  /** Deviation from the PRD's four values: a request that is not a Google request at all. Only ever paired with kind 'other'. */
  | 'not_google';

export interface ClassifiedGoogleRequest {
  kind: GoogleRequestKind;
  transport: GoogleTransport;
  /** GTM-/G-/AW-/GT-/DC- ID from id= / tid= / path, when present and well-formed. */
  tagId: string | null;
  /** e.g. '/metrics' when transport = 'gtg'. No trailing slash. */
  reservedPath: string | null;
}

export interface GoogleMatchContext {
  /** The advertiser's own hostname. Without it only Google-owned hosts classify (the pre-GTG behaviour). */
  siteHostname?: string;
  /** From client_gtg_endpoints (Sprint 3). Path prefixes, e.g. '/metrics'. */
  knownGtgPaths?: string[];
  /** Hostnames or URLs of verified sGTM endpoints for this client. */
  knownSgtmOrigins?: string[];
}

// ── IDs ──────────────────────────────────────────────────────────────────────

// Strict patterns guard against a coincidental `?id=` on the advertiser's own
// domain; Google-owned hosts need no such guard and keep the loose prefix test
// the pre-gateway detectors used, so nothing they accepted is lost.
const STRICT = {
  gtm: /^GTM-[A-Z0-9]{4,10}$/,
  tag: /^(?:G-[A-Z0-9]{6,12}|AW-\d{6,}|GT-[A-Z0-9]{6,}|DC-\d{3,})$/,
  g: /^G-[A-Z0-9]{6,12}$/,
};
const LOOSE = {
  gtm: /^GTM-[A-Z0-9]+$/,
  tag: /^(?:G-[A-Z0-9]+|AW-\d+|GT-[A-Z0-9]+|DC-\d+)$/,
  g: /^G-[A-Z0-9]+$/,
};
type IdPatterns = typeof STRICT;

function validId(raw: string | null, pattern: RegExp): string | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  return pattern.test(v) ? v : null;
}

// ── Hosts ────────────────────────────────────────────────────────────────────

const GOOGLE_HOST_SUFFIXES = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'googleadservices.com',
  'doubleclick.net',
  'google.com',
];

export function isGoogleHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return GOOGLE_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

const SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'co.in', 'com.sg', 'com.mx', 'co.za', 'com.tr', 'com.hk',
]);

function baseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.').filter(Boolean);
  const lastTwo = parts.slice(-2).join('.');
  return SECOND_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function isSameSite(requestHostname: string, siteHostname: string): boolean {
  if (!requestHostname || !siteHostname) return false;
  return baseDomain(requestHostname) === baseDomain(siteHostname);
}

const stripWww = (h: string): string => h.toLowerCase().replace(/^www\./, '');

/** Hostname-label signature of a server-side GTM / tagging server (e.g. sgtm.example.com, gtm-msr.example.com). */
function hasSgtmSignature(hostname: string): boolean {
  return /(^|[.-])(sgtm|gtm-msr|ss-gtm|tagging|stape)([.-]|$)/i.test(hostname);
}

function hostOf(originOrHost: string): string {
  try {
    return new URL(originOrHost.includes('://') ? originOrHost : `https://${originOrHost}`).hostname.toLowerCase();
  } catch {
    return originOrHost.toLowerCase();
  }
}

// ── Shape ────────────────────────────────────────────────────────────────────

interface Shape {
  kind: Exclude<GoogleRequestKind, 'other'>;
  tagId: string | null;
}

const GA4_HIT_PATH = /\/(?:g|mp)\/collect(?:\/|$)/;
const ADS_HIT_PATH = /\/pagead\/(?:1p-)?(?:conversion|viewthroughconversion|user-list)\/(\d{6,})/;

function parse(raw: string, ctx: GoogleMatchContext): URL | null {
  try {
    return ctx.siteHostname ? new URL(raw, `https://${ctx.siteHostname}`) : new URL(raw);
  } catch {
    return null;
  }
}

function shapeOf(u: URL, ids: IdPatterns): Shape | null {
  const path = u.pathname;

  if (GA4_HIT_PATH.test(path)) {
    return { kind: 'ga4_hit', tagId: validId(u.searchParams.get('tid'), ids.g) };
  }
  const ads = ADS_HIT_PATH.exec(path);
  if (ads) return { kind: 'ads_hit', tagId: `AW-${ads[1]}` };

  const id = u.searchParams.get('id');
  const gtmId = validId(id, ids.gtm);
  if (gtmId) return { kind: 'gtm_container_load', tagId: gtmId };
  if (/\/gtm\.js$/.test(path)) return { kind: 'gtm_container_load', tagId: null };

  const tagId = validId(id, ids.tag);
  if (tagId) return { kind: 'google_tag_load', tagId };
  if (/\/gtag\/js$/.test(path)) return { kind: 'google_tag_load', tagId: null };

  return null;
}

/**
 * Host-agnostic cheap check: could this URL be a Google tag load or hit?
 * Used by dataCapture's capture filter, which has no site context and should
 * over-capture rather than miss a first-party gateway request.
 */
export function looksLikeGoogleRequestShape(rawUrl: string): boolean {
  const u = parse(rawUrl, {});
  return u !== null && shapeOf(u, STRICT) !== null;
}

const NOT_GOOGLE: ClassifiedGoogleRequest = { kind: 'other', transport: 'not_google', tagId: null, reservedPath: null };

function reservedPathOf(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

function matchesKnownGtgPath(pathname: string, known: string[] | undefined): string | null {
  for (const p of known ?? []) {
    const prefix = reservedPathOf(p.startsWith('/') ? p : `/${p}`);
    if (prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`))) return prefix;
  }
  return null;
}

// ── Single-request classification ────────────────────────────────────────────

export function classifyGoogleRequest(url: string, ctx: GoogleMatchContext = {}): ClassifiedGoogleRequest {
  const u = parse(url, ctx);
  if (!u) return NOT_GOOGLE;

  const host = u.hostname.toLowerCase();
  const googleHost = isGoogleHost(host);
  const shape = shapeOf(u, googleHost ? LOOSE : STRICT);

  if (!shape) {
    return googleHost
      ? { kind: 'other', transport: 'google_direct', tagId: null, reservedPath: null }
      : NOT_GOOGLE;
  }

  const result = (transport: GoogleTransport, reservedPath: string | null = null): ClassifiedGoogleRequest => ({
    kind: shape.kind,
    transport,
    tagId: shape.tagId,
    reservedPath,
  });

  // 1. known sGTM endpoint for this client
  if ((ctx.knownSgtmOrigins ?? []).some((o) => hostOf(o) === host)) return result('sgtm');

  // 2. registered gateway path on a same-site host
  const sameSite = !!ctx.siteHostname && isSameSite(host, ctx.siteHostname);
  if (sameSite) {
    const known = matchesKnownGtgPath(u.pathname, ctx.knownGtgPaths);
    if (known) return result('gtg', known);
  }

  // 3. Google-owned hostname
  if (googleHost) return result('google_direct');

  // Not Google's host and not the advertiser's: a shape match here is a coincidence.
  if (!sameSite) return NOT_GOOGLE;

  // 4. sGTM signature in the hostname
  if (hasSgtmSignature(host)) return result('sgtm');

  // 5. same-site. A LOADER on the site's own host under a reserved path
  //    (`/metrics/?id=GTM-…`) is the gateway shape. A loader that ends in a
  //    file name (`/gtm.js`) or sits on another subdomain could equally be a
  //    self-hosted copy or sGTM, so it stays ambiguous.
  const isLoader = shape.kind === 'gtm_container_load' || shape.kind === 'google_tag_load';
  const onSiteHost = !!ctx.siteHostname && stripWww(host) === stripWww(ctx.siteHostname);
  const endsInFile = /\/(?:gtm\.js|js)$/.test(u.pathname);
  if (isLoader && onSiteHost && !endsInFile && reservedPathOf(u.pathname)) {
    return result('gtg', reservedPathOf(u.pathname));
  }
  return result('unknown_first_party');
}

// ── Capture-level classification ─────────────────────────────────────────────

export interface RequestLike {
  url: string;
}

export type ClassifiedRequest<T extends RequestLike> = ClassifiedGoogleRequest & { request: T };

/**
 * Classify a whole capture. Two things a single URL cannot tell us:
 *  - a first-party measurement hit is gateway traffic when it sits under the
 *    reserved path of a gateway loader seen in the same capture;
 *  - a bare `/{path}/` (the gtag GTG `src`, no query) is only a Google tag load
 *    when a tagged measurement hit under the same prefix follows it.
 */
export function classifyGoogleRequests<T extends RequestLike>(
  requests: readonly T[],
  ctx: GoogleMatchContext = {},
): Array<ClassifiedRequest<T>> {
  const out: Array<ClassifiedRequest<T>> = requests.map((request) => ({
    ...classifyGoogleRequest(request.url, ctx),
    request,
  }));

  const siteHost = ctx.siteHostname ? stripWww(ctx.siteHostname) : null;
  const isHit = (c: ClassifiedGoogleRequest): boolean => c.kind === 'ga4_hit' || c.kind === 'ads_hit';
  const underPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

  // Bare `/{path}/` load: same host, no query, no file name, tagged hit under the prefix.
  if (siteHost) {
    for (const c of out) {
      if (!(c.kind === 'other' && c.transport === 'not_google')) continue;
      const u = parse(c.request.url, ctx);
      if (!u || u.search || stripWww(u.hostname) !== siteHost || !u.pathname.endsWith('/')) continue;
      const prefix = reservedPathOf(u.pathname);
      if (!prefix || /\.[a-z0-9]+$/i.test(prefix)) continue;
      const followingHit = out.find((h) => {
        if (!isHit(h) || h === c || h.tagId === null) return false;
        const hu = parse(h.request.url, ctx);
        return !!hu && stripWww(hu.hostname) === siteHost && underPrefix(hu.pathname, prefix);
      });
      if (followingHit) {
        c.kind = 'google_tag_load';
        c.transport = 'gtg';
        c.reservedPath = prefix;
        c.tagId = followingHit.tagId;
      }
    }
  }

  // Reserved paths: registered, plus every gateway loader seen here.
  const gtgPrefixes = new Map<string, true>();
  for (const p of ctx.knownGtgPaths ?? []) gtgPrefixes.set(reservedPathOf(p.startsWith('/') ? p : `/${p}`), true);
  for (const c of out) if (c.transport === 'gtg' && c.reservedPath) gtgPrefixes.set(c.reservedPath, true);

  // Upgrade same-site hits/loads under a gateway prefix.
  for (const c of out) {
    if (c.transport !== 'unknown_first_party') continue;
    const u = parse(c.request.url, ctx);
    if (!u || !siteHost || stripWww(u.hostname) !== siteHost) continue;
    for (const prefix of gtgPrefixes.keys()) {
      if (underPrefix(u.pathname, prefix)) {
        c.transport = 'gtg';
        c.reservedPath = prefix;
        break;
      }
    }
  }

  return out;
}

// ── Summaries callers actually need ──────────────────────────────────────────

export interface GoogleCaptureSummary {
  gtmContainerIds: string[];
  googleTagLoadIds: string[];
  ga4HitIds: string[];
  adsHitIds: string[];
  gtgPaths: string[];
  hasGtgTraffic: boolean;
  hasGoogleDirectLoad: boolean;
  /** Same-site traffic we cannot attribute to the gateway or to sGTM. */
  hasUnknownFirstParty: boolean;
}

export function summariseGoogleCapture<T extends RequestLike>(
  classified: ReadonlyArray<ClassifiedRequest<T>>,
): GoogleCaptureSummary {
  const uniq = (xs: Array<string | null>): string[] => [...new Set(xs.filter((x): x is string => !!x))];
  const loads = classified.filter((c) => c.kind === 'gtm_container_load' || c.kind === 'google_tag_load');
  return {
    gtmContainerIds: uniq(classified.filter((c) => c.kind === 'gtm_container_load').map((c) => c.tagId)),
    googleTagLoadIds: uniq(classified.filter((c) => c.kind === 'google_tag_load').map((c) => c.tagId)),
    ga4HitIds: uniq(classified.filter((c) => c.kind === 'ga4_hit').map((c) => c.tagId)),
    adsHitIds: uniq(classified.filter((c) => c.kind === 'ads_hit').map((c) => c.tagId)),
    gtgPaths: uniq(classified.filter((c) => c.transport === 'gtg').map((c) => c.reservedPath)),
    hasGtgTraffic: classified.some((c) => c.transport === 'gtg'),
    hasGoogleDirectLoad: loads.some((c) => c.transport === 'google_direct'),
    hasUnknownFirstParty: classified.some((c) => c.kind !== 'other' && c.transport === 'unknown_first_party'),
  };
}

// ── Inline GTM snippet ───────────────────────────────────────────────────────

export interface InlineGtmSnippet {
  containerId: string;
  /** The `src` the snippet builds, with the ID appended: https://www.googletagmanager.com/gtm.js?id=GTM-X or /metrics/?id=GTM-X */
  url: string;
}

/**
 * Parses Google's standard GTM bootstrap, including the gateway variant where
 * `j.src` is a first-party path. Returns null if the text is not a GTM snippet.
 */
export function parseInlineGtmSnippet(text: string): InlineGtmSnippet | null {
  const src = /\bj\.src\s*=\s*(['"])(.*?)\1\s*\+\s*i\b/.exec(text);
  const id = /['"](GTM-[A-Z0-9]{4,10})['"]\s*\)/.exec(text);
  if (!src || !id) return null;
  return { containerId: id[1], url: `${src[2]}${id[1]}` };
}

/** GTM container IDs from a mixed list of `<script src>` values and `inline:<snippet>` entries. */
export function extractGtmContainerIds(sources: readonly string[], ctx: GoogleMatchContext = {}): string[] {
  const ids: string[] = [];
  for (const s of sources) {
    if (s.startsWith('inline:')) {
      const snippet = parseInlineGtmSnippet(s.slice('inline:'.length));
      if (snippet) ids.push(snippet.containerId);
      continue;
    }
    const c = classifyGoogleRequest(s, ctx);
    if (c.kind === 'gtm_container_load' && c.tagId) ids.push(c.tagId);
  }
  return [...new Set(ids)];
}

// ── Context helper ───────────────────────────────────────────────────────────

/** Build a match context from the audited site's URL (+ any client-known endpoints). Never throws. */
export function contextForSite(
  websiteUrl: string | null | undefined,
  extras: Pick<GoogleMatchContext, 'knownGtgPaths' | 'knownSgtmOrigins'> = {},
): GoogleMatchContext {
  let siteHostname: string | undefined;
  try {
    if (websiteUrl) siteHostname = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname.toLowerCase();
  } catch {
    siteHostname = undefined;
  }
  return { siteHostname, ...extras };
}

/** Transports whose GA4/Ads hits we count as "Google measurement fired". Unattributable same-site traffic is not. */
export function isCountableTransport(t: GoogleTransport): boolean {
  return t === 'google_direct' || t === 'gtg';
}

// ── Detection from raw page sources ──────────────────────────────────────────

export interface GoogleSourceDetection {
  gtmDetected: boolean;
  gtmContainerId: string | null;
  /** A Google tag or GA4 measurement was seen, from a Google host or the site's own gateway path. */
  ga4Detected: boolean;
  ga4MeasurementId: string | null;
  googleAdsDetected: boolean;
  googleAdsId: string | null;
  gtgPaths: string[];
}

/**
 * Detect GTM / Google tag / Google Ads from a flat list of script `src` values,
 * `inline:<snippet>` entries and network URLs. Shared by the Planning-mode page
 * capture and the developer quick check so neither keys on a Google hostname.
 */
export function detectGoogleFromSources(sources: readonly string[], ctx: GoogleMatchContext = {}): GoogleSourceDetection {
  const urls = sources.filter((s) => !s.startsWith('inline:'));
  const summary = summariseGoogleCapture(classifyGoogleRequests(urls.map((url) => ({ url })), ctx));
  const gtmIds = extractGtmContainerIds(sources, ctx);
  const tagIds = [...summary.googleTagLoadIds, ...summary.ga4HitIds];
  const ga4Id = tagIds.find((id) => id.startsWith('G-')) ?? null;
  const adsId = [...summary.googleTagLoadIds, ...summary.adsHitIds].find((id) => id.startsWith('AW-')) ?? null;
  return {
    gtmDetected: gtmIds.length > 0,
    gtmContainerId: gtmIds[0] ?? null,
    ga4Detected: ga4Id !== null || summary.googleTagLoadIds.length > 0 || summary.ga4HitIds.length > 0,
    ga4MeasurementId: ga4Id,
    googleAdsDetected: adsId !== null || summary.adsHitIds.length > 0,
    googleAdsId: adsId,
    gtgPaths: summary.gtgPaths,
  };
}
