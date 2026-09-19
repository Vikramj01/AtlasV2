/**
 * identityResolver unit tests — docs/prd/crm-outcome-integration.md §6.3.
 */

import { describe, it, expect } from 'vitest';
import { resolveIdentity, resolveIdentityPropertyMap, DEFAULT_IDENTITY_PROPERTY_MAP } from '../identityResolver';

describe('resolveIdentityPropertyMap', () => {
  it('falls back to the default map when no config override is given', () => {
    expect(resolveIdentityPropertyMap(null)).toEqual(DEFAULT_IDENTITY_PROPERTY_MAP);
  });

  it('lets a config override individual keys without dropping the rest', () => {
    const map = resolveIdentityPropertyMap({ gclid: 'my_custom_gclid_prop' });
    expect(map.gclid).toBe('my_custom_gclid_prop');
    expect(map.fbclid).toBe(DEFAULT_IDENTITY_PROPERTY_MAP.fbclid);
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
});
