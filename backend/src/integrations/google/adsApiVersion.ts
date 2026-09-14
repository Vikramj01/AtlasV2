/**
 * Google Ads API version — single source of truth.
 *
 * Every Google Ads REST call site (reconciliation sync/stats sync, connection
 * testing, post-OAuth account discovery, AIR ingestion, offline-conversion
 * conversion-action lookup, refund conversion adjustments) imports this
 * instead of hardcoding a version string. Previously five call sites pinned
 * `v18` and two pinned `v17` — both already sunset (v17 on 2025-06-04, v18 on
 * 2025-08-20), so every Google Ads API request Atlas made had been failing
 * silently or loudly since whichever call site's version lapsed first.
 *
 * Current: v24, sunsets May 2027. (v25 is current as of writing but sunsets
 * Aug 2027 — no benefit here over v24 for the three months of extra runway.)
 * Bump this constant well before the sunset date; do not let it drift again.
 */
export const GOOGLE_ADS_API_VERSION = 'v24';
