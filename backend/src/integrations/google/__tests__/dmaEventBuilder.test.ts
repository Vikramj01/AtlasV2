/**
 * dmaEventBuilder tests — covers the two gaps closed by the Sprint 7
 * ECAPI/DMA field-parity verification pass (external_id -> userId,
 * client_user_agent/client_ip_address -> eventDeviceInfo), plus existing
 * identifier/ad-identifier/consent mapping to guard against regressions.
 */
import { describe, it, expect } from 'vitest';
import { buildDMAEvent, buildUserIdentifiersFromHashed } from '../dmaEventBuilder';
import type { AtlasEvent, HashedIdentifier } from '@/types/capi';

function makeEvent(overrides: Partial<AtlasEvent> = {}): AtlasEvent {
  return {
    event_id: 'e1',
    event_name: 'purchase',
    event_time: 1700000000,
    event_source_url: 'https://example.com/checkout',
    action_source: 'website',
    user_data: {},
    consent_state: { analytics: 'granted', marketing: 'granted', personalisation: 'granted', functional: 'granted' },
    ...overrides,
  };
}

describe('buildUserIdentifiersFromHashed', () => {
  it('maps email/phone to separate UserIdentifier entries', () => {
    const identifiers: HashedIdentifier[] = [
      { type: 'email', value: 'hashed-email', is_hashed: true },
      { type: 'phone', value: 'hashed-phone', is_hashed: true },
    ];
    const result = buildUserIdentifiersFromHashed(identifiers);
    expect(result).toEqual([{ emailAddress: 'hashed-email' }, { phoneNumber: 'hashed-phone' }]);
  });

  it('groups address fields into a single UserIdentifier.address entry', () => {
    const identifiers: HashedIdentifier[] = [
      { type: 'fn', value: 'John', is_hashed: true },
      { type: 'ct', value: 'London', is_hashed: true },
    ];
    const result = buildUserIdentifiersFromHashed(identifiers);
    expect(result).toEqual([{ address: { givenName: 'John', city: 'London' } }]);
  });

  it('does not emit a UserIdentifier for external_id/fbc/fbp', () => {
    const identifiers: HashedIdentifier[] = [
      { type: 'external_id', value: 'hashed-ext', is_hashed: true },
      { type: 'fbc', value: 'fb.1.123.abc', is_hashed: false },
    ];
    expect(buildUserIdentifiersFromHashed(identifiers)).toEqual([]);
  });
});

describe('buildDMAEvent', () => {
  it('maps user_data.external_id to the top-level userId field, not into UserIdentifier[]', () => {
    const event = makeEvent({ user_data: { external_id: 'cust-123' } });
    const dmaEvent = buildDMAEvent(event, []);
    expect(dmaEvent.userId).toBe('cust-123');
    expect(dmaEvent.userData).toBeUndefined();
  });

  it('omits userId when external_id is absent', () => {
    const dmaEvent = buildDMAEvent(makeEvent(), []);
    expect(dmaEvent.userId).toBeUndefined();
  });

  it('maps client_user_agent/client_ip_address into eventDeviceInfo', () => {
    const event = makeEvent({
      user_data: { client_user_agent: 'Mozilla/5.0', client_ip_address: '203.0.113.5' },
    });
    const dmaEvent = buildDMAEvent(event, []);
    expect(dmaEvent.eventDeviceInfo).toEqual({ userAgent: 'Mozilla/5.0', ipAddress: '203.0.113.5' });
  });

  it('omits eventDeviceInfo entirely when neither field is present', () => {
    const dmaEvent = buildDMAEvent(makeEvent(), []);
    expect(dmaEvent.eventDeviceInfo).toBeUndefined();
  });

  it('maps gclid/wbraid/gbraid into adIdentifiers', () => {
    const event = makeEvent({ user_data: { gclid: 'g1', wbraid: 'w1', gbraid: 'b1' } });
    const dmaEvent = buildDMAEvent(event, []);
    expect(dmaEvent.adIdentifiers).toEqual({ gclid: 'g1', wbraid: 'w1', gbraid: 'b1' });
  });

  it('maps consent_state.marketing/personalisation into DMA consent', () => {
    const event = makeEvent({
      consent_state: { analytics: 'granted', marketing: 'denied', personalisation: 'granted', functional: 'granted' },
    });
    const dmaEvent = buildDMAEvent(event, []);
    expect(dmaEvent.consent).toEqual({ adUserData: 'CONSENT_DENIED', adPersonalization: 'CONSENT_GRANTED' });
  });

  it('uses the transactionId override when provided, over custom_data.order_id', () => {
    const event = makeEvent({ custom_data: { order_id: 'order-from-event' } });
    const dmaEvent = buildDMAEvent(event, [], { transactionId: 'order-from-dedup' });
    expect(dmaEvent.transactionId).toBe('order-from-dedup');
  });
});
