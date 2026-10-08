/**
 * GA4 Admin / L11 / Junk Gate PRD §A.6: the publish service's own safety
 * properties — Atlas-created workspaces only, rollback target read first,
 * compiler errors / sync conflicts refused before anything goes live,
 * fingerprint passed, rollback refuses when the live version moved.
 * Request/response shapes follow the live Tag Manager v2 Discovery Document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { publishAtlasWorkspace, republishVersion, isAtlasWorkspaceName, GtmPublishRefused } from '../gtmPublishService';

interface Call { method: string; path: string; body?: unknown }
let calls: Call[];
let routes: Record<string, { status?: number; body?: unknown }>;

function installFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace('https://www.googleapis.com/tagmanager/v2', '');
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => path.includes(k));
    const r = key ? routes[key] : { status: 500, body: {} };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body ?? {}, text: async () => JSON.stringify(r.body ?? {}) };
  }));
}

const input = { accessToken: 'tok', accountId: '1', containerId: '2', workspaceId: '9' };
const okRoutes = () => ({
  '/workspaces/9:create_version': { body: { containerVersion: { containerVersionId: '42', fingerprint: 'fp 1' } } },
  '/versions/42:publish': { body: { containerVersion: { containerVersionId: '42' } } },
  'versions:live': { body: { containerVersionId: '41' } },
  '/workspaces/9': { body: { name: 'Atlas Deploy — 2026-10-06 10:00' } },
});

beforeEach(() => {
  routes = okRoutes();
  installFetch();
});

describe('isAtlasWorkspaceName', () => {
  it('accepts the names Atlas deploy paths create, nothing else', () => {
    expect(isAtlasWorkspaceName('Atlas Deploy — 2026-10-06 10:00')).toBe(true);
    expect(isAtlasWorkspaceName('Atlas · Google tag split · 2026-10-06')).toBe(true);
    expect(isAtlasWorkspaceName('Default Workspace')).toBe(false);
    expect(isAtlasWorkspaceName('My Atlas experiment')).toBe(false);
    expect(isAtlasWorkspaceName(undefined)).toBe(false);
  });
});

describe('publishAtlasWorkspace', () => {
  it('reads the live version BEFORE creating the version, then creates and publishes with the fingerprint', async () => {
    const out = await publishAtlasWorkspace(input);
    expect(out).toEqual({ published_version_id: '42', previous_version_id: '41' });
    const order = calls.map((c) => `${c.method} ${c.path.split('?')[0]}`);
    expect(order.indexOf('GET /accounts/1/containers/2/versions:live')).toBeLessThan(order.indexOf('POST /accounts/1/containers/2/workspaces/9:create_version'));
    expect(order.indexOf('POST /accounts/1/containers/2/workspaces/9:create_version')).toBeLessThan(order.indexOf('POST /accounts/1/containers/2/versions/42:publish'));
    expect(calls.find((c) => c.path.includes(':publish'))!.path).toContain('?fingerprint=fp%201');
  });

  it('records previous_version_id null for a container that was never published (live 404)', async () => {
    routes['versions:live'] = { status: 404 };
    expect((await publishAtlasWorkspace(input)).previous_version_id).toBeNull();
  });

  it('refuses a workspace Atlas did not create, before creating or publishing anything', async () => {
    routes['/workspaces/9'] = { body: { name: 'Default Workspace' } };
    await expect(publishAtlasWorkspace(input)).rejects.toMatchObject({ code: 'NOT_ATLAS_WORKSPACE' });
    expect(calls.some((c) => c.path.includes(':create_version') || c.path.includes(':publish'))).toBe(false);
  });

  it('refuses compiler errors and never publishes', async () => {
    routes['/workspaces/9:create_version'] = { body: { compilerError: true, containerVersion: { containerVersionId: '42' } } };
    await expect(publishAtlasWorkspace(input)).rejects.toMatchObject({ code: 'COMPILER_ERROR' });
    expect(calls.some((c) => c.path.includes(':publish'))).toBe(false);
  });

  it('refuses a sync conflict and never publishes', async () => {
    routes['/workspaces/9:create_version'] = { body: { syncStatus: { mergeConflict: true } } };
    await expect(publishAtlasWorkspace(input)).rejects.toMatchObject({ code: 'SYNC_CONFLICT' });
    expect(calls.some((c) => c.path.includes(':publish'))).toBe(false);
  });

  it('refuses when no version was created', async () => {
    routes['/workspaces/9:create_version'] = { body: {} };
    await expect(publishAtlasWorkspace(input)).rejects.toMatchObject({ code: 'NO_VERSION_CREATED' });
  });

  it('a compiler error on the publish response is refused too', async () => {
    routes['/versions/42:publish'] = { body: { compilerError: true } };
    await expect(publishAtlasWorkspace(input)).rejects.toBeInstanceOf(GtmPublishRefused);
  });

  it('a Google error surfaces as an ordinary error (not a refusal)', async () => {
    routes['/versions/42:publish'] = { status: 403, body: { error: 'nope' } };
    await expect(publishAtlasWorkspace(input)).rejects.toThrow(/failed \(403\)/);
  });
});

describe('republishVersion', () => {
  const args = { accessToken: 'tok', accountId: '1', containerId: '2', versionId: '41', expectedLiveVersionId: '42' };

  it('re-publishes the previous version when the live version is still the one Atlas published', async () => {
    routes['versions:live'] = { body: { containerVersionId: '42' } };
    routes['/versions/41:publish'] = { body: {} };
    expect(await republishVersion(args)).toEqual({ previous_version_id: '42' });
    expect(calls.find((c) => c.path.includes('/versions/41:publish'))).toBeDefined();
  });

  it('refuses — and publishes nothing — when someone published since', async () => {
    routes['versions:live'] = { body: { containerVersionId: '99' } };
    await expect(republishVersion(args)).rejects.toMatchObject({ code: 'LIVE_VERSION_CHANGED' });
    expect(calls.some((c) => c.path.includes(':publish'))).toBe(false);
  });
});

describe('where publishing is reachable from (PRD §A.6: never a queue job or scheduled task)', () => {
  const root = join(__dirname, '../../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]));

  it('only the gtm route imports the publish service', () => {
    const importers = walk(root).filter((f) => f.endsWith('.ts') && /gtmPublishService/.test(readFileSync(f, 'utf8')) && !f.endsWith('gtmPublishService.ts'));
    expect(importers.map((f) => f.replace(root, ''))).toEqual(['/api/routes/gtm.ts']);
  });

  it('no queue, worker or scheduler file references publish or rollback', () => {
    const files = walk(join(root, 'services/queue'));
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/gtmPublishService|publishAtlasWorkspace|republishVersion/);
  });

  it('the draft deploy path can never publish: it has no create_version/publish call', () => {
    const src = readFileSync(join(root, 'services/gtm/gtmDeployService.ts'), 'utf8');
    expect(src).not.toMatch(/:create_version|:publish\b|versions:live/);
  });
});
