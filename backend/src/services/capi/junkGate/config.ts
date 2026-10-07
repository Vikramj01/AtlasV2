/**
 * Gate config resolution + event scope (GA4 Admin / L11 / Junk Gate PRD §C.8).
 *
 * No saved config row = the PRD default: `observe`, default lead-type scope, default thresholds.
 * Observe never delays or blocks, so the default is safe to apply to every client from day one
 * and is what gives real hit-rate data before anyone opts into `enforce`.
 */
import { ACTION_PRIMITIVES } from '@/services/journey/actionPrimitives';
import { DEFAULT_THRESHOLDS, type JunkGateConfig } from './types';

/**
 * Default scope: the lead-type events of the Journey Builder's own vocabulary — every
 * `conversion`-category primitive EXCEPT purchase (paid orders are not junk leads, PRD §C.4) —
 * plus the common names a hand-built tag sends for the same thing.
 */
const PRIMITIVE_LEAD_EVENTS = ACTION_PRIMITIVES
  .filter((p) => p.category === 'conversion' && p.key !== 'purchase')
  .flatMap((p) => [p.key, ...p.platform_mappings.filter((m) => m.platform === 'ga4').map((m) => m.event_name)]);

export const DEFAULT_LEAD_EVENT_NAMES: ReadonlySet<string> = new Set(
  [...PRIMITIVE_LEAD_EVENTS, 'lead', 'form_submit', 'contact', 'schedule', 'submit_application', 'complete_registration', 'request_quote', 'book_demo']
    .map((n) => n.toLowerCase()),
);

/** Names that are never in scope by default even if a client's config is empty. */
const NEVER_BY_DEFAULT = new Set(['purchase', 'refund', 'atlas_refund', 'atlas_order_cancellation']);

export function isEventInScope(eventName: string, config: Pick<JunkGateConfig, 'event_names'>): boolean {
  const name = eventName.trim().toLowerCase();
  if (config.event_names.length > 0) return config.event_names.some((n) => n.trim().toLowerCase() === name);
  return !NEVER_BY_DEFAULT.has(name) && DEFAULT_LEAD_EVENT_NAMES.has(name);
}

interface RawConfigRow {
  mode?: JunkGateConfig['mode'];
  event_names?: string[] | null;
  rule_flags?: JunkGateConfig['rule_flags'] | null;
  thresholds?: Partial<JunkGateConfig['thresholds']> | null;
}

/** Merges a stored row over the defaults; a missing/partial row can never produce an invalid config. */
export function resolveGateConfig(row: RawConfigRow | null | undefined): JunkGateConfig {
  const t = row?.thresholds ?? {};
  const pos = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    mode: row?.mode ?? 'observe',
    event_names: row?.event_names ?? [],
    rule_flags: row?.rule_flags ?? {},
    thresholds: {
      duplicate_window_minutes: pos(t.duplicate_window_minutes, DEFAULT_THRESHOLDS.duplicate_window_minutes),
      velocity_max: pos(t.velocity_max, DEFAULT_THRESHOLDS.velocity_max),
      velocity_window_minutes: pos(t.velocity_window_minutes, DEFAULT_THRESHOLDS.velocity_window_minutes),
      suspect_soft_hits: pos(t.suspect_soft_hits, DEFAULT_THRESHOLDS.suspect_soft_hits),
    },
  };
}
