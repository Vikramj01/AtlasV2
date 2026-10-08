/**
 * Hold-timeout ceiling (GA4 Admin / L11 / Junk Gate PRD §C.6, C2).
 *
 * A held conversion that is released after a destination's ingest window would be silently
 * dropped by that destination, so the timeout is clamped to the SHORTEST window among the
 * providers the event is bound for, minus a 12-hour safety margin. A clamp is surfaced
 * (`clamped: true`) so the review tab can say the saved timeout was shortened and why.
 *
 * Sourced windows come from `outcomes/ingestWindows.ts` (each carries its own verification note).
 * A provider with NO sourced limit gets the conservative `UNSOURCED_WINDOW_DAYS` rather than an
 * invented larger figure.
 */
import type { CAPIProvider } from '@/types/capi';
import {
  GOOGLE_ADS_INGEST_WINDOW_DAYS, LINKEDIN_INGEST_WINDOW_DAYS, META_WEBSITE_INGEST_WINDOW_DAYS,
} from '@/services/outcomes/ingestWindows';

export const SAFETY_MARGIN_HOURS = 12;
export const MIN_HOLD_HOURS = 1;
/** Providers whose live-event window is not sourced anywhere in this codebase. */
export const UNSOURCED_WINDOW_DAYS = 7;

export function providerWindowDays(provider: CAPIProvider): number {
  switch (provider) {
    case 'meta': return META_WEBSITE_INGEST_WINDOW_DAYS;
    // Shortest Google Ads import path (Enhanced Conversions for Leads, 63 days) — the held event
    // may be released through either path, so the shorter bound applies.
    case 'google': return Math.min(...Object.values(GOOGLE_ADS_INGEST_WINDOW_DAYS));
    case 'linkedin': return LINKEDIN_INGEST_WINDOW_DAYS;
    default: return UNSOURCED_WINDOW_DAYS;
  }
}

/** Hours a hold may stay open for these providers: shortest window minus the margin. */
export function holdCeilingHours(providers: CAPIProvider[]): number {
  if (providers.length === 0) return Number.POSITIVE_INFINITY;
  const days = Math.min(...providers.map(providerWindowDays));
  return Math.max(MIN_HOLD_HOURS, days * 24 - SAFETY_MARGIN_HOURS);
}

export interface HoldTimeout {
  hours: number;
  clamped: boolean;
  ceiling_hours: number;
}

export function clampHoldTimeout(requestedHours: number, providers: CAPIProvider[]): HoldTimeout {
  const ceiling = holdCeilingHours(providers);
  const hours = Math.max(MIN_HOLD_HOURS, Math.min(requestedHours, ceiling));
  return { hours, clamped: hours < requestedHours, ceiling_hours: ceiling };
}
