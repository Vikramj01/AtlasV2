/**
 * Google Stack Alignment sprint plan, Sprint 4 (C2 execution + C5):
 *
 *   - GA4_CROSS_DOMAIN_LINKING_MISSING and SGTM_ROUTING_NOT_CONFIGURED both
 *     filtered strictly on tag.type === 'gaawc'. Migrating Atlas's own
 *     generator to 'googtag' (this sprint) without widening these two rules
 *     would create a silent blind spot: every newly-generated container
 *     would skip both checks entirely (0 GA4 Config tags found by their old
 *     filter), even though the same client-facing gaps they exist to catch
 *     are just as real on a googtag container. This suite proves the fix.
 *
 *   - C5 also asks for a genuine expected-vs-actual cross-domain domain
 *     mismatch check, independent of whether a Google Ads Conversion Linker
 *     (gclidw) tag is present — GA4's own linked_domains and Google Ads'
 *     linker are separate mechanisms. Covered below.
 */
import { describe, it, expect } from 'vitest';

import { GA4_CROSS_DOMAIN_LINKING_MISSING, SGTM_ROUTING_NOT_CONFIGURED } from '../tagConfiguration';
import type { AuditData, GTMTag, GTMTrigger, GTMContainerSnapshot } from '@/types/audit';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeGa4ConfigTag(type: 'gaawc' | 'googtag', overrides: Partial<GTMTag> = {}): GTMTag {
  return {
    tagId: '1',
    name: 'GA4 - Config',
    type,
    firingTriggerId: ['1'],
    parameter: [],
    ...overrides,
  };
}

function withLinkedDomains(tag: GTMTag, domains: string[]): GTMTag {
  return {
    ...tag,
    parameter: [
      ...(tag.parameter ?? []),
      { type: 'LIST', key: 'linked_domains', list: domains.map((value) => ({ type: 'TEMPLATE', value })) },
    ],
  };
}

function outboundClickTrigger(): GTMTrigger {
  return {
    triggerId: '2',
    name: 'Click - Just Links',
    type: 'CLICK',
    filter: [{ type: 'EQUALS', parameter: [{ type: 'TEMPLATE', key: 'arg1', value: '{{Click URL}}' }] }],
  };
}

function makeContainer(tags: GTMTag[], triggers: GTMTrigger[] = []): GTMContainerSnapshot {
  return {
    container_id: 'c1',
    fetched_at: '2026-01-01T00:00:00Z',
    source: 'gtm_api',
    tags,
    triggers,
    variables: [],
    built_in_variables: [],
    consent_default_tag: null,
  };
}

function makeAuditData(overrides: Partial<AuditData> = {}): AuditData {
  return {
    audit_id: 'a1',
    website_url: 'https://example.com',
    funnel_type: 'ecommerce',
    region: 'us',
    dataLayer: [],
    networkRequests: [],
    cookieSnapshots: [],
    localStorageSnapshots: [],
    injected: { gclid: '', fbclid: '' },
    ...overrides,
  };
}

// ── GA4_CROSS_DOMAIN_LINKING_MISSING ──────────────────────────────────────────

describe('GA4_CROSS_DOMAIN_LINKING_MISSING', () => {
  it('skips when no GTM container is present', () => {
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(makeAuditData());
    expect(result.status).toBe('skipped');
  });

  it('skips when neither gaawc nor googtag is present', () => {
    const container = makeContainer([{ tagId: '1', name: 'Meta - Base Pixel', type: 'html', firingTriggerId: ['1'], parameter: [] }]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(makeAuditData({ gtmContainer: container }));
    expect(result.status).toBe('skipped');
  });

  it('recognises a legacy gaawc GA4 Config tag (existing client containers must keep auditing correctly)', () => {
    const tag = makeGa4ConfigTag('gaawc');
    const container = makeContainer([tag], [outboundClickTrigger()]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(makeAuditData({ gtmContainer: container }));
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).toContain('(gaawc)');
  });

  it('fails loudly on a googtag container with no linked_domains and an outbound click trigger (no silent blind spot post-migration)', () => {
    const tag = makeGa4ConfigTag('googtag');
    const container = makeContainer([tag], [outboundClickTrigger()]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(makeAuditData({ gtmContainer: container }));
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).toContain('(googtag)');
  });

  it('passes on a googtag container with linked_domains covering the outbound trigger', () => {
    const tag = withLinkedDomains(makeGa4ConfigTag('googtag'), ['app.example.com']);
    const container = makeContainer([tag], [outboundClickTrigger()]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(makeAuditData({ gtmContainer: container }));
    expect(result.status).toBe('pass');
  });

  it('flags a declared-vs-actual domain mismatch even with no outbound click trigger detected', () => {
    const tag = withLinkedDomains(makeGa4ConfigTag('googtag'), ['app.example.com']);
    const container = makeContainer([tag]); // no triggers at all
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(
      makeAuditData({ gtmContainer: container, client_secondary_domains: ['app.example.com', 'checkout.example.com'] }),
    );
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.join(' ')).toContain('checkout.example.com');
  });

  it('domain mismatch check fires independently of whether a Google Ads Conversion Linker (gclidw) tag exists', () => {
    const ga4Tag = withLinkedDomains(makeGa4ConfigTag('googtag'), []);
    const linkerTag: GTMTag = {
      tagId: '2',
      name: 'Google Ads - Conversion Linker',
      type: 'gclidw',
      firingTriggerId: ['1'],
      parameter: [{ type: 'BOOLEAN', key: 'enableCrossDomainLinking', value: 'true' }],
    };
    const container = makeContainer([ga4Tag, linkerTag]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(
      makeAuditData({ gtmContainer: container, client_secondary_domains: ['checkout.example.com'] }),
    );
    // A correctly-configured Conversion Linker says nothing about GA4's own
    // linked_domains — the mismatch must still be caught.
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.join(' ')).toContain('checkout.example.com');
  });

  it('passes when linked_domains fully covers the client-declared secondary domains', () => {
    const tag = withLinkedDomains(makeGa4ConfigTag('googtag'), ['checkout.example.com', 'app.example.com']);
    const container = makeContainer([tag]);
    const result = GA4_CROSS_DOMAIN_LINKING_MISSING.test(
      makeAuditData({ gtmContainer: container, client_secondary_domains: ['checkout.example.com'] }),
    );
    expect(result.status).toBe('pass');
  });
});

// ── SGTM_ROUTING_NOT_CONFIGURED ────────────────────────────────────────────────

describe('SGTM_ROUTING_NOT_CONFIGURED', () => {
  it('recognises a googtag GA4 Config tag, not just legacy gaawc', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [{ type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'false' }],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(makeAuditData({ gtmContainer: container, sgtmVerified: true }));
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).toContain('(googtag)');
  });

  it('passes when a googtag tag correctly routes through the verified server container', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [{ type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'true' }],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(makeAuditData({ gtmContainer: container, sgtmVerified: true }));
    expect(result.status).toBe('pass');
  });

  it('still recognises a legacy gaawc tag', () => {
    const tag = makeGa4ConfigTag('gaawc', {
      parameter: [{ type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'true' }],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(makeAuditData({ gtmContainer: container, sgtmVerified: true }));
    expect(result.status).toBe('pass');
  });

  // ── Sprint 7 (C8 remainder, item 3): diagnosis → remediation ────────────────

  it('names the exact expected serverContainerUrl when routing is missing and the endpoint is known', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [{ type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'false' }],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(
      makeAuditData({ gtmContainer: container, sgtmVerified: true, client_sgtm_endpoint_url: 'https://sgtm.example.com' }),
    );
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.join(' ')).toContain('https://sgtm.example.com');
    expect(result.technical_details.expected).toContain('https://sgtm.example.com');
  });

  it('falls back to the generic finding when routing is missing and no endpoint URL is known', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [{ type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'false' }],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(
      makeAuditData({ gtmContainer: container, sgtmVerified: true }),
    );
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence[0]).not.toContain('https://');
  });

  it('flags routing pointed at a stale/wrong serverContainerUrl even though enableSendToServerContainer is true (drift)', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [
        { type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'true' },
        { type: 'TEMPLATE', key: 'serverContainerUrl', value: 'https://old-sgtm.example.com' },
      ],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(
      makeAuditData({ gtmContainer: container, sgtmVerified: true, client_sgtm_endpoint_url: 'https://sgtm.example.com' }),
    );
    expect(result.status).toBe('fail');
    expect(result.technical_details.evidence.join(' ')).toContain('old-sgtm.example.com');
    expect(result.technical_details.evidence.join(' ')).toContain('sgtm.example.com');
  });

  it('passes when routing is enabled and serverContainerUrl matches the verified endpoint exactly', () => {
    const tag = makeGa4ConfigTag('googtag', {
      parameter: [
        { type: 'BOOLEAN', key: 'enableSendToServerContainer', value: 'true' },
        { type: 'TEMPLATE', key: 'serverContainerUrl', value: 'https://sgtm.example.com' },
      ],
    });
    const container = makeContainer([tag]);
    const result = SGTM_ROUTING_NOT_CONFIGURED.test(
      makeAuditData({ gtmContainer: container, sgtmVerified: true, client_sgtm_endpoint_url: 'https://sgtm.example.com' }),
    );
    expect(result.status).toBe('pass');
  });
});
