/**
 * GTM Container Auto-Deploy
 *
 * Pushes a generated GTMContainerJSON (gtmContainerGenerator.ts's export-format
 * shape) into a client's live GTM workspace via the Tag Manager API v2, reusing
 * the same OAuth access token gtm.ts's refreshGtmToken() already produces for
 * the read-only sync path (worker.ts).
 *
 * The Tag Manager API has no bulk "import container JSON" endpoint — that's a
 * GTM-UI-only feature (Admin -> Import Container). The API only exposes
 * per-resource create calls, so this walks the generated container in
 * dependency order (folders -> variables -> triggers -> tags) and creates
 * each resource individually, remapping the generator's placeholder numeric
 * IDs to the real IDs the API assigns:
 *   - Tag/trigger/variable references inside `parameter` values use GTM's
 *     "{{Variable Name}}" string syntax, resolved BY NAME at runtime — no ID
 *     remapping needed there (this is why the generator can safely reuse
 *     fixed placeholder IDs like '0'/'1'/'2' across every generated container).
 *   - `firingTriggerId` (on tags) and `folderId` (on tags/triggers/variables)
 *     DO reference the generator's placeholder IDs directly and must be
 *     remapped to the real IDs returned by each create call below.
 *
 * Creates a new workspace per deploy and never publishes it (edit-only OAuth
 * scope — tagmanager.edit.containers, not tagmanager.publish) — the client
 * reviews and publishes manually in the GTM UI, same as a manual JSON import
 * today. If a create call partway through fails, the workspace is left in a
 * partial state for the client to inspect or delete manually in GTM; the API
 * has no cross-resource transaction to roll back.
 */

import type {
  GTMContainerJSON,
  GTMTagDef,
  GTMTriggerDef,
  GTMVariableDef,
} from '@/services/planning/generators/gtmContainerGenerator';
import logger from '@/utils/logger';

const GTM_API_BASE = 'https://www.googleapis.com/tagmanager/v2';

export interface GtmDeploySummary {
  workspace_id: string;
  workspace_url: string;
  folders_created: number;
  variables_created: number;
  triggers_created: number;
  tags_created: number;
  built_in_variables_enabled: number;
}

async function gtmApiRequest<T>(
  accessToken: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GTM_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GTM API ${method} ${path} failed (${res.status}): ${errBody}`);
  }

  return res.json() as Promise<T>;
}

function tagCreatePayload(tag: GTMTagDef, firingTriggerId: string[], parentFolderId?: string) {
  return {
    name: tag.name,
    type: tag.type,
    parameter: tag.parameter,
    firingTriggerId,
    tagFiringOption: tag.tagFiringOption,
    consentSettings: tag.consentSettings
      ? { consentStatus: tag.consentSettings.consentStatus }
      : undefined,
    parentFolderId,
  };
}

function triggerCreatePayload(trigger: GTMTriggerDef, parentFolderId?: string) {
  return {
    name: trigger.name,
    type: trigger.type,
    customEventFilter: trigger.customEventFilter,
    filter: trigger.filter,
    parentFolderId,
  };
}

function variableCreatePayload(variable: GTMVariableDef, parentFolderId?: string) {
  return {
    name: variable.name,
    type: variable.type,
    parameter: variable.parameter,
    notes: variable.notes,
    parentFolderId,
  };
}

/**
 * Deploys a generated container into a live GTM workspace under the given
 * account/container. `accessToken` must already be a valid (refreshed)
 * OAuth access token for a connection with tagmanager.edit.containers scope.
 */
export async function deployContainerToGtm(
  accessToken: string,
  accountId: string,
  containerId: string,
  container: GTMContainerJSON,
): Promise<GtmDeploySummary> {
  const base = `/accounts/${accountId}/containers/${containerId}`;
  const version = container.containerVersion;

  // ── 1. Create a new workspace for this deploy ────────────────────────────
  const workspaceName = `Atlas Deploy — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const workspace = await gtmApiRequest<{ workspaceId: string }>(accessToken, 'POST', `${base}/workspaces`, {
    name: workspaceName,
    description: 'Created by Atlas Planning Mode. Review in GTM Preview mode, then publish when ready — Atlas never publishes automatically.',
  });
  const workspaceId = workspace.workspaceId;
  const wsBase = `${base}/workspaces/${workspaceId}`;

  // ── 2. Built-in variables ─────────────────────────────────────────────────
  let builtInsEnabled = 0;
  if (version.builtInVariable.length > 0) {
    const qs = version.builtInVariable.map((b) => `type=${encodeURIComponent(b.type)}`).join('&');
    await gtmApiRequest(accessToken, 'POST', `${wsBase}/built_in_variables?${qs}`);
    builtInsEnabled = version.builtInVariable.length;
  }

  // ── 3. Folders ────────────────────────────────────────────────────────────
  const folderIdMap = new Map<string, string>(); // generator folderId -> real folderId
  for (const folder of version.folder) {
    const created = await gtmApiRequest<{ folderId: string }>(accessToken, 'POST', `${wsBase}/folders`, {
      name: folder.name,
    });
    folderIdMap.set(folder.folderId, created.folderId);
  }
  const remapFolder = (folderId?: string): string | undefined =>
    folderId ? folderIdMap.get(folderId) : undefined;

  // ── 4. Variables ──────────────────────────────────────────────────────────
  let variablesCreated = 0;
  for (const v of version.variable) {
    await gtmApiRequest(accessToken, 'POST', `${wsBase}/variables`, variableCreatePayload(v, remapFolder(v.folderId)));
    variablesCreated++;
  }

  // ── 5. Triggers ───────────────────────────────────────────────────────────
  const triggerIdMap = new Map<string, string>(); // generator triggerId -> real triggerId
  for (const t of version.trigger) {
    const created = await gtmApiRequest<{ triggerId: string }>(
      accessToken, 'POST', `${wsBase}/triggers`, triggerCreatePayload(t, remapFolder(t.folderId)),
    );
    triggerIdMap.set(t.triggerId, created.triggerId);
  }
  const remapTriggerIds = (ids: string[]): string[] =>
    ids.map((id) => triggerIdMap.get(id)).filter((id): id is string => Boolean(id));

  // ── 6. Tags ───────────────────────────────────────────────────────────────
  let tagsCreated = 0;
  for (const tag of version.tag) {
    await gtmApiRequest(
      accessToken, 'POST', `${wsBase}/tags`,
      tagCreatePayload(tag, remapTriggerIds(tag.firingTriggerId), remapFolder(tag.folderId)),
    );
    tagsCreated++;
  }

  logger.info(
    { workspaceId, tagsCreated, variablesCreated, triggersCreated: triggerIdMap.size, foldersCreated: folderIdMap.size },
    'GTM container deployed to live workspace',
  );

  return {
    workspace_id: workspaceId,
    workspace_url: `https://tagmanager.google.com/#/container/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`,
    folders_created: folderIdMap.size,
    variables_created: variablesCreated,
    triggers_created: triggerIdMap.size,
    tags_created: tagsCreated,
    built_in_variables_enabled: builtInsEnabled,
  };
}
