/**
 * GTG endpoint input handling — pure, no I/O.
 * docs/prd/google-tag-gateway.md §1.1 (path rules), §6.1 (registry), §6.3 (probe URLs).
 *
 * The reserved path reroutes ALL traffic under it, so a bad path breaks part of
 * the client's site; the rules Google documents (not `/`, at most 100 chars) are
 * enforced here and again by the table's CHECK.
 */
import { isSameSite } from '@/services/google/googleEndpointMatcher';
import { kindFromGoogleId } from '@/services/google/googleTagClassifier';

export const MAX_RESERVED_PATH_LENGTH = 100;
export const MAX_ENDPOINTS_PER_CLIENT = 10;

export interface GtgEndpointInput {
  hostname: string;
  reserved_path: string;
  tag_or_container: string;
}

export type EndpointValidation =
  | { ok: true; value: GtgEndpointInput }
  | { ok: false; error: string };

/** Lower-cases and strips scheme/port/path from a pasted host or URL. Null if it is not a plain hostname. */
export function normaliseHostname(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host) ? host : null;
}

/** '/metrics/' -> '/metrics'. Null if it cannot be a safe reserved path. */
export function normaliseReservedPath(raw: string): string | null {
  let p = raw.trim();
  if (!p) return null;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  if (!p || p === '/') return null;
  if (p.length > MAX_RESERVED_PATH_LENGTH) return null;
  // A single path, no query/fragment/dot-segments/whitespace.
  if (!/^\/[A-Za-z0-9._~\-]+(\/[A-Za-z0-9._~\-]+)*$/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  return p;
}

export function normaliseTagOrContainer(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (/^GTM-[A-Z0-9]{4,10}$/.test(v)) return v;
  return kindFromGoogleId(v) !== 'unknown' && /^(G|AW|GT|DC)-[A-Z0-9]+$/.test(v) ? v : null;
}

/**
 * Validates an operator-entered endpoint. The hostname must belong to the
 * client's own site: Atlas only probes a path the client has registered, and
 * never an arbitrary host.
 */
export function validateEndpointInput(input: GtgEndpointInput, clientHostname: string): EndpointValidation {
  const hostname = normaliseHostname(input.hostname);
  if (!hostname) return { ok: false, error: 'Hostname must be a plain domain such as www.example.com' };

  const clientHost = normaliseHostname(clientHostname);
  if (!clientHost || !isSameSite(hostname, clientHost)) {
    return { ok: false, error: `Hostname must belong to this client's site (${clientHost ?? clientHostname})` };
  }

  const reserved_path = normaliseReservedPath(input.reserved_path);
  if (!reserved_path) {
    return { ok: false, error: `Path must start with / , not be / on its own, be at most ${MAX_RESERVED_PATH_LENGTH} characters and use only letters, digits and . _ ~ -` };
  }

  const tag_or_container = normaliseTagOrContainer(input.tag_or_container);
  if (!tag_or_container) return { ok: false, error: 'Tag or container ID must be a GTM-, G-, AW-, GT- or DC- ID' };

  return { ok: true, value: { hostname, reserved_path, tag_or_container } };
}

/** The two health URLs Google documents for verifying a gateway path (PRD §1.1). */
export function endpointProbeUrls(ep: { hostname: string; reserved_path: string }): { healthy: string; geo: string } {
  const base = `https://${ep.hostname}${ep.reserved_path}`;
  return { healthy: `${base}/healthy`, geo: `${base}/?validate_geo=healthy` };
}
