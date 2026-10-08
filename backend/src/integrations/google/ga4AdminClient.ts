/**
 * GA4 Admin API client — one base-URL constant per API version, shared by every
 * GA4 Admin call site (discovery, connection testing, key-event sync, config
 * snapshot sync). Previously the v1beta base URL and an `adminGet()` helper
 * were copy-pasted into three files.
 *
 * Verified live against the Discovery Documents (revision 20261003, GA4 Admin
 * / L11 / Junk Gate PRD §12 Sprint 0): every read Atlas makes accepts
 * `analytics.readonly`. Property, data streams, Google Ads links, data
 * retention and key events are on `v1beta`; **enhanced measurement settings
 * exist on `v1alpha` only**. An alpha surface can change without notice, so
 * callers must treat a `v1alpha` failure as "not observed", never as a finding.
 *
 * This is the Analytics Admin API — unrelated to the Google Ads REST API or
 * the Data Manager API (see Key Technical Decision §24).
 */

export const GA4_ADMIN_BASE_V1BETA = 'https://analyticsadmin.googleapis.com/v1beta';
export const GA4_ADMIN_BASE_V1ALPHA = 'https://analyticsadmin.googleapis.com/v1alpha';

export type Ga4AdminVersion = 'v1beta' | 'v1alpha';

export function ga4AdminBase(version: Ga4AdminVersion): string {
  return version === 'v1alpha' ? GA4_ADMIN_BASE_V1ALPHA : GA4_ADMIN_BASE_V1BETA;
}

export class Ga4AdminError extends Error {
  constructor(public readonly path: string, public readonly status: number) {
    super(`GA4 Admin API ${path}: HTTP ${status}`);
    this.name = 'Ga4AdminError';
  }
}

export async function ga4AdminGet(
  path: string,
  accessToken: string,
  version: Ga4AdminVersion = 'v1beta',
): Promise<unknown> {
  const res = await fetch(`${ga4AdminBase(version)}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Ga4AdminError(path, res.status);
  return res.json();
}
