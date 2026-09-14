/**
 * Google Stack Alignment sprint plan, Sprint 5 (C4) — exhaustive unit
 * coverage for the pure decision function. Integration-level proof that
 * this is actually wired into generateGTMContainer()/buildGTMContainer()
 * lives in googleStackFixtures.test.ts and composableOutputGenerator.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { decideConversionLinker } from '../renderer/linkerDecisionEngine';

const BASE = {
  hasGoogleTagFiring: true,
  hasFloodlight: false,
  crossDomainNeeded: false,
  serverContainerConfigured: false,
};

describe('decideConversionLinker', () => {
  it('suppresses the linker only in the single-domain, googtag-present, non-sGTM, non-Floodlight case', () => {
    expect(decideConversionLinker(BASE).emitConversionLinker).toBe(false);
  });

  it('emits when no sitewide Google tag is firing', () => {
    const result = decideConversionLinker({ ...BASE, hasGoogleTagFiring: false });
    expect(result.emitConversionLinker).toBe(true);
    expect(result.reason).toContain('No sitewide Google tag');
  });

  it('emits when cross-domain linking is needed, even with a Google tag present', () => {
    const result = decideConversionLinker({ ...BASE, crossDomainNeeded: true });
    expect(result.emitConversionLinker).toBe(true);
    expect(result.reason).toContain('Cross-domain');
  });

  it('emits when sGTM routing is configured, even with a Google tag present', () => {
    const result = decideConversionLinker({ ...BASE, serverContainerConfigured: true });
    expect(result.emitConversionLinker).toBe(true);
    expect(result.reason).toContain('Server-side GTM');
  });

  it('emits when Floodlight is present, even with a Google tag present', () => {
    const result = decideConversionLinker({ ...BASE, hasFloodlight: true });
    expect(result.emitConversionLinker).toBe(true);
    expect(result.reason).toContain('Floodlight');
  });

  it('Floodlight takes precedence when combined with other true inputs', () => {
    const result = decideConversionLinker({
      hasGoogleTagFiring: false,
      hasFloodlight: true,
      crossDomainNeeded: true,
      serverContainerConfigured: true,
    });
    expect(result.emitConversionLinker).toBe(true);
    expect(result.reason).toContain('Floodlight');
  });

  it('emits when neither a Google tag nor any special case applies (worst case: always emit, never silently drop attribution)', () => {
    const result = decideConversionLinker({
      hasGoogleTagFiring: false,
      hasFloodlight: false,
      crossDomainNeeded: false,
      serverContainerConfigured: false,
    });
    expect(result.emitConversionLinker).toBe(true);
  });
});
