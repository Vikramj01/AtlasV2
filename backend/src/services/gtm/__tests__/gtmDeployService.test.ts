/**
 * gtmDeployService tests — verifies the generator's placeholder folder/trigger
 * IDs get remapped to the real IDs the Tag Manager API assigns, while variable
 * references inside tag/trigger parameters (GTM's "{{Name}}" string syntax)
 * pass through untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deployContainerToGtm } from '../gtmDeployService';
import type { GTMContainerJSON } from '@/services/planning/generators/gtmContainerGenerator';

function makeContainer(): GTMContainerJSON {
  return {
    exportFormatVersion: 2,
    exportTime: '2026-01-01 00:00:00',
    containerVersion: {
      path: 'accounts/0/containers/0/versions/0',
      accountId: '0',
      containerId: '0',
      containerVersionId: '0',
      name: 'Atlas Generated Tracking',
      description: '',
      container: {
        path: 'accounts/0/containers/0',
        accountId: '0',
        containerId: '0',
        name: 'Atlas Generated Tracking',
        publicId: 'GTM-PLACEHOLDER',
        usageContext: ['WEB'],
        fingerprint: '0',
        tagManagerUrl: 'https://tagmanager.google.com/',
      },
      tag: [
        {
          accountId: '0', containerId: '0', tagId: '10', name: 'GA4 - Config', type: 'gaawc',
          parameter: [{ type: 'TEMPLATE', key: 'measurementId', value: '{{CONST - GA4 Measurement ID}}' }],
          firingTriggerId: ['1'],
          tagFiringOption: 'oncePerEvent',
          folderId: '2',
          fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
        },
      ],
      trigger: [
        {
          accountId: '0', containerId: '0', triggerId: '1', name: 'All Pages', type: 'PAGEVIEW',
          folderId: '2', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
        },
      ],
      variable: [
        {
          accountId: '0', containerId: '0', variableId: '5', name: 'CONST - GA4 Measurement ID', type: 'c',
          parameter: [{ type: 'TEMPLATE', key: 'value', value: 'G-XXXXXXXXXX' }],
          folderId: '2', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/',
        },
      ],
      folder: [
        { accountId: '0', containerId: '0', folderId: '2', name: 'Atlas — Configuration', fingerprint: '0', tagManagerUrl: 'https://tagmanager.google.com/' },
      ],
      builtInVariable: [
        { accountId: '0', containerId: '0', type: 'PAGE_URL', name: 'Page URL' },
      ],
      fingerprint: '0',
      tagManagerUrl: 'https://tagmanager.google.com/',
    },
  };
}

describe('deployContainerToGtm', () => {
  let calls: Array<{ method: string; url: string; body: any }>;

  beforeEach(() => {
    calls = [];
    let folderCounter = 0;
    let triggerCounter = 0;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, url, body });

      if (url.includes('/workspaces') && method === 'POST' && !url.includes('/tags') && !url.includes('/triggers') && !url.includes('/variables') && !url.includes('/folders') && !url.includes('built_in_variables')) {
        return { ok: true, json: async () => ({ workspaceId: 'ws-real-1' }) };
      }
      if (url.includes('/built_in_variables')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('/folders')) {
        folderCounter++;
        return { ok: true, json: async () => ({ folderId: `real-folder-${folderCounter}` }) };
      }
      if (url.includes('/variables')) {
        return { ok: true, json: async () => ({ variableId: 'real-var-1' }) };
      }
      if (url.includes('/triggers')) {
        triggerCounter++;
        return { ok: true, json: async () => ({ triggerId: `real-trigger-${triggerCounter}` }) };
      }
      if (url.includes('/tags')) {
        return { ok: true, json: async () => ({ tagId: 'real-tag-1' }) };
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }));
  });

  it('creates a new workspace and never publishes it', async () => {
    await deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer());
    const workspaceCall = calls.find((c) => c.url.endsWith('/accounts/acct-1/containers/GTM-XXXXX/workspaces'));
    expect(workspaceCall).toBeDefined();
    expect(calls.some((c) => c.url.includes('publish'))).toBe(false);
  });

  it('remaps folderId references on tags/triggers/variables to real folder IDs', async () => {
    await deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer());

    const tagCall = calls.find((c) => c.url.includes('/tags'));
    const triggerCall = calls.find((c) => c.url.includes('/triggers'));
    const variableCall = calls.find((c) => c.url.includes('/variables'));

    expect(tagCall!.body.parentFolderId).toBe('real-folder-1');
    expect(triggerCall!.body.parentFolderId).toBe('real-folder-1');
    expect(variableCall!.body.parentFolderId).toBe('real-folder-1');
  });

  it('remaps firingTriggerId on tags to the real trigger ID, not the generator placeholder', async () => {
    await deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer());
    const tagCall = calls.find((c) => c.url.includes('/tags'));
    expect(tagCall!.body.firingTriggerId).toEqual(['real-trigger-1']);
  });

  it('leaves {{Name}} variable references inside tag parameters untouched', async () => {
    await deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer());
    const tagCall = calls.find((c) => c.url.includes('/tags'));
    const measurementIdParam = tagCall!.body.parameter.find((p: any) => p.key === 'measurementId');
    expect(measurementIdParam.value).toBe('{{CONST - GA4 Measurement ID}}');
  });

  it('returns a summary with real counts and a workspace URL', async () => {
    const summary = await deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer());
    expect(summary.workspace_id).toBe('ws-real-1');
    expect(summary.workspace_url).toContain('acct-1');
    expect(summary.workspace_url).toContain('ws-real-1');
    expect(summary.folders_created).toBe(1);
    expect(summary.variables_created).toBe(1);
    expect(summary.triggers_created).toBe(1);
    expect(summary.tags_created).toBe(1);
    expect(summary.built_in_variables_enabled).toBe(1);
  });

  it('throws with context when a create call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'insufficient scope' })));
    await expect(deployContainerToGtm('token', 'acct-1', 'GTM-XXXXX', makeContainer())).rejects.toThrow(/403/);
  });
});
