/**
 * Google Stack Alignment — Sprint 3 (C2 design, C3): composableOutputGenerator.ts
 *
 * Before this sprint, `buildGTMContainer()` here independently hand-rolled the
 * GTM output and got real GTM field names wrong: a Floodlight Counter type
 * ('flc') mislabeled as "Conversion Linker", 'googtag' used for a plain
 * GA4-config shape, lowercase type codes matching no real GTM field
 * ('template'/'list'/'customEvent'/'pageview'), 'firingRuleId' (not a real
 * field — GTM's field is 'firingTriggerId', referencing trigger IDs, never
 * `{{Name}}`-interpolated strings), and Google Ads `awct` parameter keys that
 * don't exist on the real tag (`value`/`currency` instead of
 * `conversionValue`/`currencyCode`). None of that would have imported into
 * GTM without error (Correction 6 / C3's own framing: "broken output to
 * replace", not "a second working implementation to unify with").
 *
 * This suite checks two things the sprint's acceptance criteria ask for:
 *   1. The sitewide Google tag layer now goes through the same shared
 *      renderer Planning uses (googleTagArchitecture.ts) — so equivalent
 *      inputs produce equivalent Google infrastructure across both paths.
 *   2. The full container (Google infra + Meta + per-signal tags) passes the
 *      existing structural validator with no errors — the closest this
 *      sandbox can get to "imports into GTM without error" without a live
 *      Google account and browser session to attempt a real import with.
 */
import { describe, it, expect } from 'vitest';

import { buildGTMContainer } from '../composableOutputGenerator';
import { generateGTMContainer } from '@/services/planning/generators/gtmContainerGenerator';
import type { GTMParameter, GTMTagDef } from '@/services/planning/generators/gtmContainerGenerator';
import { validateGTMContainer } from '@/services/planning/generators/gtmSchemaValidator';
import type { ClientWithDetails, ClientPlatform } from '@/types/organisation';
import type { SignalWithOverrides, Signal } from '@/types/signal';
import type { ClientIdentityConfig } from '@/types/enrichment';

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makePlatform(platform: ClientPlatform['platform'], measurementId: string | null, isActive = true): ClientPlatform {
  return {
    id: `plat_${platform}`,
    client_id: 'c1',
    platform,
    is_active: isActive,
    measurement_id: measurementId,
    config: {},
    is_verified: false,
    verified_at: null,
  };
}

function makeClient(overrides: Partial<ClientWithDetails> = {}): ClientWithDetails {
  return {
    id: 'c1',
    organisation_id: 'org1',
    name: 'Acme Co',
    website_url: 'https://acme.example.com',
    business_type: 'ecommerce',
    detected_platform: null,
    primary_conversion_objective: null,
    template_source_client_id: null,
    template_source_pack_id: null,
    secondary_domains: [],
    status: 'active',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    platforms: [],
    pages: [],
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig1',
    organisation_id: null,
    key: 'purchase',
    name: 'Purchase',
    description: 'A completed purchase',
    category: 'conversion',
    is_system: true,
    is_custom: false,
    source_action_primitive: null,
    required_params: [{ key: 'value', label: 'Value', type: 'number' }],
    optional_params: [],
    platform_mappings: {},
    version: 1,
    valid_from: '2026-01-01T00:00:00Z',
    deprecated_at: null,
    superseded_by_signal_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeSignalWithOverrides(signal: Signal, stageAssignment: string | null = null): SignalWithOverrides {
  return { signal, stage_assignment: stageAssignment, param_overrides: {}, enabled: true };
}

function makeIdentityConfig(overrides: Partial<ClientIdentityConfig> = {}): ClientIdentityConfig {
  return {
    id: 'ident1',
    client_id: 'c1',
    email_field: 'user.email',
    phone_field: null,
    first_name_field: null,
    last_name_field: null,
    postal_code_field: null,
    country_field: null,
    external_id_field: null,
    fbc_field: '_fbc',
    fbp_field: '_fbp',
    gclid_field: 'gclid',
    wbraid_field: 'wbraid',
    gbraid_field: 'gbraid',
    ttclid_field: 'ttclid',
    oppref_field: '__oppref',
    auto_capture_ip: false,
    auto_capture_ua: false,
    enabled_identifiers: [],
    validated_at: null,
    identity_score: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function flattenParams(params: GTMParameter[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    if (!p.key) continue;
    if (p.type === 'LIST' && p.list) {
      out[p.key] = p.list.map((item) => item.value);
    } else if (p.value !== undefined) {
      out[p.key] = p.value;
    }
  }
  return out;
}

function findTag(tags: GTMTagDef[], name: string): GTMTagDef {
  const tag = tags.find((t) => t.name === name);
  if (!tag) throw new Error(`Expected a tag named "${name}" — found: ${tags.map((t) => t.name).join(', ')}`);
  return tag;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('buildGTMContainer — sitewide Google tag architecture parity with Planning', () => {
  const client = makeClient({
    secondary_domains: ['checkout.acme.example.com'],
    platforms: [makePlatform('ga4', 'G-ACME12345'), makePlatform('google_ads', 'AW-999888777')],
  });

  const container = buildGTMContainer(client, [], null);

  it('is schema-valid — the acceptance criterion "imports into GTM without error"', () => {
    const result = validateGTMContainer(container);
    expect(result.errors).toEqual([]);
  });

  it('emits the real googtag/gclidw tag types (Sprint 4 migration), not the previous flc mislabel', () => {
    const types = container.containerVersion.tag.map((t) => t.type);
    expect(types).toContain('googtag');
    expect(types).toContain('gclidw');
    expect(types).not.toContain('flc');
  });

  it('GA4 Config and Conversion Linker are structurally IDENTICAL to what Planning produces for the same destinations', () => {
    const planningContainer = generateGTMContainer(
      [],
      { business_type: 'ecommerce', selected_platforms: ['ga4', 'google_ads'], secondary_domains: ['checkout.acme.example.com'] },
      { ga4: 'G-ACME12345', google_ads: 'AW-999888777' },
    );

    const composableGa4 = findTag(container.containerVersion.tag, 'GA4 - Config');
    const planningGa4 = findTag(planningContainer.containerVersion.tag, 'GA4 - Config');
    expect(composableGa4.type).toBe(planningGa4.type);
    expect(flattenParams(composableGa4.parameter)).toEqual(flattenParams(planningGa4.parameter));

    const composableLinker = findTag(container.containerVersion.tag, 'Google Ads - Conversion Linker');
    const planningLinker = findTag(planningContainer.containerVersion.tag, 'Google Ads - Conversion Linker');
    expect(composableLinker.type).toBe(planningLinker.type);
    expect(flattenParams(composableLinker.parameter)).toEqual(flattenParams(planningLinker.parameter));
  });

  it('cross-domain secondary_domains flow into linked_domains/domains exactly like Planning', () => {
    const ga4Tag = findTag(container.containerVersion.tag, 'GA4 - Config');
    expect(flattenParams(ga4Tag.parameter).linked_domains).toEqual(['checkout.acme.example.com']);
    const linkerTag = findTag(container.containerVersion.tag, 'Google Ads - Conversion Linker');
    expect(flattenParams(linkerTag.parameter).enableCrossDomainLinking).toBe('true');
    expect(flattenParams(linkerTag.parameter).domains).toEqual(['checkout.acme.example.com']);
  });
});

describe('buildGTMContainer — Meta Pixel uses a real GTM tag type', () => {
  const client = makeClient({ platforms: [makePlatform('meta', '123456789012345')] });
  const container = buildGTMContainer(client, [], null);

  it('Meta base pixel is Custom HTML ("html"), not the fabricated "sp" type', () => {
    const tag = findTag(container.containerVersion.tag, 'Atlas — Meta Pixel Base');
    expect(tag.type).toBe('html');
    const html = flattenParams(tag.parameter).html as string;
    expect(html).toContain("fbq('init', '{{CONST - Meta Pixel ID}}')");
    expect(html).toContain("fbq('track', 'PageView')");
  });

  it('passes the schema validator', () => {
    expect(validateGTMContainer(container).errors).toEqual([]);
  });
});

describe('buildGTMContainer — per-signal tags use real GTM parameter names', () => {
  const client = makeClient({
    platforms: [makePlatform('ga4', 'G-ACME12345'), makePlatform('google_ads', 'AW-999888777/LaBeL1')],
  });
  const signal = makeSignal({
    key: 'purchase',
    category: 'conversion',
    platform_mappings: {
      ga4: { event_name: 'purchase', param_mapping: { value: 'ecommerce.value', currency: 'ecommerce.currency' } },
      google_ads: { event_name: 'conversion', param_mapping: { value: 'ecommerce.value', currency: 'ecommerce.currency' } },
    },
  });
  const container = buildGTMContainer(client, [makeSignalWithOverrides(signal)], null);

  it('Google Ads conversion tag uses conversionValue/currencyCode, not value/currency', () => {
    const tag = findTag(container.containerVersion.tag, 'Atlas — Google Ads: Purchase');
    expect(tag.type).toBe('awct');
    const params = flattenParams(tag.parameter);
    expect(params).toHaveProperty('conversionValue');
    expect(params).toHaveProperty('currencyCode');
    expect(params).not.toHaveProperty('value');
    expect(params).not.toHaveProperty('currency');
    expect(params.conversionId).toBe('AW-999888777');
    expect(params.conversionLabel).toBe('LaBeL1');
  });

  it('per-signal trigger fires on a real CUSTOM_EVENT trigger (not the old lowercase "customEvent")', () => {
    const trigger = container.containerVersion.trigger.find((t) => t.name === 'CE - purchase');
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('CUSTOM_EVENT');
    const tag = findTag(container.containerVersion.tag, 'Atlas — Google Ads: Purchase');
    expect(tag.firingTriggerId).toEqual([trigger!.triggerId]);
  });

  it('is fully schema-valid end to end', () => {
    expect(validateGTMContainer(container).errors).toEqual([]);
  });
});

describe('buildGTMContainer — identity variables use the real DLV shape', () => {
  const client = makeClient({ platforms: [] });
  const identityConfig = makeIdentityConfig({ email_field: 'user.email', phone_field: 'user.phone' });
  const container = buildGTMContainer(client, [], identityConfig);

  it('creates DLV variables (type "v"), not the previous fabricated "dlv" type', () => {
    const emailVar = container.containerVersion.variable.find((v) => v.name === 'DLV - user.email');
    expect(emailVar).toBeDefined();
    expect(emailVar!.type).toBe('v');
    const params = flattenParams(emailVar!.parameter);
    expect(params.name).toBe('user.email');
    expect(params.dataLayerVersion).toBe('2');
  });

  it('skips unconfigured identity fields', () => {
    const phoneVar = container.containerVersion.variable.find((v) => v.name === 'DLV - user.phone');
    expect(phoneVar).toBeDefined();
    const nameVar = container.containerVersion.variable.find((v) => v.name?.includes('first_name'));
    expect(nameVar).toBeUndefined();
  });
});

describe('buildGTMContainer — no platforms configured', () => {
  it('still produces a schema-valid container with just the All Pages trigger', () => {
    const client = makeClient({ platforms: [] });
    const container = buildGTMContainer(client, [], null);
    expect(validateGTMContainer(container).errors).toEqual([]);
    expect(container.containerVersion.trigger.some((t) => t.name === 'All Pages' && t.type === 'PAGEVIEW')).toBe(true);
    expect(container.containerVersion.tag).toEqual([]);
  });
});
