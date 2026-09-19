/**
 * identityResolver unit tests — docs/prd/crm-outcome-integration.md §6.3.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveIdentity,
  resolveIdentityPropertyMap,
  DEFAULT_IDENTITY_PROPERTY_MAP,
  SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP,
} from '../identityResolver';

describe('resolveIdentityPropertyMap', () => {
  it('falls back to the HubSpot default map when no provider is given', () => {
    expect(resolveIdentityPropertyMap(null)).toEqual(DEFAULT_IDENTITY_PROPERTY_MAP);
  });

  it('lets a config override individual keys without dropping the rest', () => {
    const map = resolveIdentityPropertyMap({ gclid: 'my_custom_gclid_prop' });
    expect(map.gclid).toBe('my_custom_gclid_prop');
    expect(map.fbclid).toBe(DEFAULT_IDENTITY_PROPERTY_MAP.fbclid);
  });

  it('falls back to the Salesforce default map for provider "salesforce" (Sprint 10)', () => {
    expect(resolveIdentityPropertyMap(null, 'salesforce')).toEqual(SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP);
  });

  it('Salesforce defaults use __c-suffixed custom fields and PascalCase standard fields', () => {
    const map = resolveIdentityPropertyMap(null, 'salesforce');
    expect(map.gclid).toBe('atlas_gclid__c');
    expect(map.event_id).toBe('atlas_event_id__c');
    expect(map.email).toBe('Email');
    expect(map.phone).toBe('Phone');
  });

  it('a config override still applies on top of the Salesforce default map', () => {
    const map = resolveIdentityPropertyMap({ gclid: 'My_Custom_Gclid__c' }, 'salesforce');
    expect(map.gclid).toBe('My_Custom_Gclid__c');
    expect(map.email).toBe(SALESFORCE_DEFAULT_IDENTITY_PROPERTY_MAP.email);
  });
});

describe('resolveIdentity', () => {
  it('resolves click_id as the strongest match when a click ID is present', () => {
    const result = resolveIdentity(
      { atlas_gclid: 'gclid-value', email: 'lead@example.com' },
      null,
    );
    expect(result.method).toBe('click_id');
    expect(result.keys_present).toContain('gclid');
    expect(result.keys_present).toContain('email');
    expect(result.values.gclid).toBe('gclid-value');
  });

  it('falls back to hashed_email when no click ID is present', () => {
    const result = resolveIdentity({ email: 'lead@example.com' }, null);
    expect(result.method).toBe('hashed_email');
    expect(result.keys_present).toEqual(['email']);
  });

  it('falls back to hashed_phone when only phone is present', () => {
    const result = resolveIdentity({ phone: '+15551234567' }, null);
    expect(result.method).toBe('hashed_phone');
  });

  it('resolves unresolved when nothing is present — never fabricates an identifier', () => {
    const result = resolveIdentity({}, null);
    expect(result.method).toBe('unresolved');
    expect(result.keys_present).toEqual([]);
    expect(result.values).toEqual({});
  });

  it('treats an empty-string property value as absent, not present', () => {
    const result = resolveIdentity({ atlas_gclid: '', email: '   ' }, null);
    expect(result.method).toBe('unresolved');
  });

  it('prefers the original event identity when atlas_event_id joins a known capi_events row', () => {
    const result = resolveIdentity(
      { atlas_event_id: 'evt-123' },
      null,
      { method: 'click_id', keys_present: ['gclid'] },
    );
    expect(result.method).toBe('click_id');
    expect(result.keys_present).toContain('event_id');
    expect(result.keys_present).toContain('gclid');
  });

  it('does not consult the original event when atlas_event_id itself is absent', () => {
    const result = resolveIdentity(
      { email: 'lead@example.com' },
      null,
      { method: 'click_id', keys_present: ['gclid'] },
    );
    // atlas_event_id wasn't present on this record, so the original-event
    // shortcut never applies — falls through to the record's own email.
    expect(result.method).toBe('hashed_email');
  });

  it('respects a custom identity_property_map', () => {
    const result = resolveIdentity(
      { my_custom_gclid_prop: 'gclid-value' },
      { gclid: 'my_custom_gclid_prop' },
    );
    expect(result.method).toBe('click_id');
    expect(result.values.gclid).toBe('gclid-value');
  });

  it('resolves against Salesforce-shaped field names when provider is "salesforce" (Sprint 10)', () => {
    const result = resolveIdentity(
      { atlas_gclid__c: 'gclid-value', Email: 'lead@example.com' },
      null,
      null,
      'salesforce',
    );
    expect(result.method).toBe('click_id');
    expect(result.keys_present).toContain('gclid');
    expect(result.keys_present).toContain('email');
  });

  it('does not resolve HubSpot-shaped lowercase field names under the Salesforce default map', () => {
    // 'email'/'atlas_gclid' (HubSpot's shapes) are simply absent keys on a
    // Salesforce-default resolution — never fabricated as a match.
    const result = resolveIdentity(
      { email: 'lead@example.com', atlas_gclid: 'gclid-value' },
      null,
      null,
      'salesforce',
    );
    expect(result.method).toBe('unresolved');
  });
});
