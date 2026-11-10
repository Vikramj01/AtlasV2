import { describe, it, expect } from 'vitest';
import {
  endpointProbeUrls, normaliseHostname, normaliseReservedPath, normaliseTagOrContainer, validateEndpointInput, MAX_RESERVED_PATH_LENGTH,
} from '../gtgEndpoints';

describe('normaliseReservedPath', () => {
  it('adds a leading slash, drops trailing slashes', () => {
    expect(normaliseReservedPath('metrics')).toBe('/metrics');
    expect(normaliseReservedPath('/metrics/')).toBe('/metrics');
    expect(normaliseReservedPath('/a/b/')).toBe('/a/b');
  });
  it('rejects / on its own and empty input (the path reroutes all traffic under it)', () => {
    expect(normaliseReservedPath('/')).toBeNull();
    expect(normaliseReservedPath('///')).toBeNull();
    expect(normaliseReservedPath('  ')).toBeNull();
  });
  it('rejects more than 100 characters, accepts exactly 100', () => {
    expect(normaliseReservedPath('/' + 'a'.repeat(MAX_RESERVED_PATH_LENGTH))).toBeNull();
    expect(normaliseReservedPath('/' + 'a'.repeat(MAX_RESERVED_PATH_LENGTH - 1))).toHaveLength(MAX_RESERVED_PATH_LENGTH);
  });
  it('rejects queries, fragments, spaces and dot segments', () => {
    for (const bad of ['/m?x=1', '/m#f', '/a b', '/../etc', '/a/./b', '/a//b', '/m%20x', '/a;b']) {
      expect(normaliseReservedPath(bad)).toBeNull();
    }
  });
});

describe('normaliseHostname', () => {
  it('accepts a bare host, a URL, and normalises case', () => {
    expect(normaliseHostname('WWW.Example.com')).toBe('www.example.com');
    expect(normaliseHostname('https://www.example.com/some/path?q=1')).toBe('www.example.com');
  });
  it('rejects IPs, single labels, empty and junk', () => {
    for (const bad of ['', '127.0.0.1', 'localhost', 'not a host', 'http://']) expect(normaliseHostname(bad)).toBeNull();
  });
});

describe('normaliseTagOrContainer', () => {
  it('accepts GTM- and Google tag IDs, upper-cased', () => {
    expect(normaliseTagOrContainer('gtm-abc1234')).toBe('GTM-ABC1234');
    expect(normaliseTagOrContainer('G-ABCDEF1234')).toBe('G-ABCDEF1234');
    expect(normaliseTagOrContainer('AW-123456789')).toBe('AW-123456789');
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'UA-123-1', 'abc', 'GTM-', 'G-<script>']) expect(normaliseTagOrContainer(bad)).toBeNull();
  });
});

describe('validateEndpointInput', () => {
  const input = { hostname: 'www.example.com', reserved_path: '/metrics/', tag_or_container: 'gtm-abc1234' };

  it('normalises a valid endpoint on the client site', () => {
    expect(validateEndpointInput(input, 'example.com')).toEqual({
      ok: true, value: { hostname: 'www.example.com', reserved_path: '/metrics', tag_or_container: 'GTM-ABC1234' },
    });
  });
  it('accepts a subdomain of the client site', () => {
    expect(validateEndpointInput({ ...input, hostname: 'shop.example.com' }, 'https://www.example.com/').ok).toBe(true);
  });
  it('rejects a host that is not the client site: Atlas never probes an arbitrary host', () => {
    const r = validateEndpointInput({ ...input, hostname: 'evil.com' }, 'example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/client's site/);
  });
  it('reports a bad path, a bad tag and a bad host distinctly', () => {
    expect((validateEndpointInput({ ...input, reserved_path: '/' }, 'example.com') as { error: string }).error).toMatch(/Path/);
    expect((validateEndpointInput({ ...input, tag_or_container: 'x' }, 'example.com') as { error: string }).error).toMatch(/ID/);
    expect((validateEndpointInput({ ...input, hostname: '127.0.0.1' }, 'example.com') as { error: string }).error).toMatch(/Hostname/);
  });
});

describe('endpointProbeUrls', () => {
  it('builds the two documented health URLs', () => {
    expect(endpointProbeUrls({ hostname: 'www.example.com', reserved_path: '/metrics' })).toEqual({
      healthy: 'https://www.example.com/metrics/healthy',
      geo: 'https://www.example.com/metrics/?validate_geo=healthy',
    });
  });
});
