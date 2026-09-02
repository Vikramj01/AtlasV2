/**
 * Funnel-aware conversion event resolution.
 *
 * Several Layer 2/3 rules check generic properties of "the conversion event"
 * (email captured, value present, event_id present, PII hashed, etc.) but
 * were originally written filtering dataLayer for a hardcoded `event === 'purchase'`.
 * That's correct for ecommerce but means the check can never pass for saas/lead_gen
 * audits — those funnels never fire a `purchase` event (see JOURNEY_CONFIGS in
 * browserbase/journeyConfigs.ts: saas ends at signup/onboarding, lead_gen at
 * thank_you). Rules that are conceptually funnel-agnostic resolve the right
 * event name via this module instead of hardcoding 'purchase'.
 *
 * Event names are GA4's own recommended events for each conversion type —
 * the convention a well-instrumented site is expected to follow, mirroring
 * how the original rules assumed 'purchase' as GA4's ecommerce convention.
 */
import type { AuditData, DataLayerEvent, FunnelType } from '@/types/audit';

export const CONVERSION_EVENT_NAME: Record<FunnelType, string> = {
  ecommerce: 'purchase',
  saas: 'sign_up',
  lead_gen: 'generate_lead',
};

function conversionEventName(funnelType: FunnelType | undefined): string {
  return CONVERSION_EVENT_NAME[funnelType as FunnelType] ?? CONVERSION_EVENT_NAME.ecommerce;
}

/** All dataLayer pushes matching this audit's funnel-appropriate conversion event. */
export function getConversionEvents(auditData: AuditData): DataLayerEvent[] {
  const eventName = conversionEventName(auditData.funnel_type);
  return auditData.dataLayer.filter((e) => e.event === eventName);
}

/** The last/first dataLayer push matching this audit's funnel-appropriate conversion event, if any. */
export function getConversionEvent(auditData: AuditData): DataLayerEvent | undefined {
  const eventName = conversionEventName(auditData.funnel_type);
  return auditData.dataLayer.find((e) => e.event === eventName);
}
