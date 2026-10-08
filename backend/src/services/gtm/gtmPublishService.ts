/**
 * GTM version creation, publish and rollback (GA4 Admin / L11 / Junk Gate PRD
 * §A.6). Endpoint shapes verified against the live Tag Manager API v2
 * Discovery Document (revision 20260930):
 *   POST …/workspaces/{id}:create_version → { containerVersion, compilerError, syncStatus }
 *   POST …/versions/{id}:publish[?fingerprint=] → { containerVersion, compilerError }
 *   GET  …/versions:live → ContainerVersion
 *
 * Safety properties this module enforces itself, so no caller can skip them:
 *  - Only a workspace Atlas created (name prefix) can be published — Atlas can
 *    never publish a person's own in-progress workspace.
 *  - The currently-live version is read BEFORE publishing and returned, so a
 *    rollback target always exists when the container had a live version.
 *  - A version with compiler errors, or a workspace with a sync conflict, is
 *    refused before anything goes live.
 *  - publish passes the created version's fingerprint, so a version that changed
 *    between create and publish is rejected by Google rather than published.
 *
 * Deliberately imported ONLY by the human-session route (api/routes/gtm.ts):
 * never from a queue job or scheduled task (asserted by a test).
 */
const GTM_API_BASE = 'https://www.googleapis.com/tagmanager/v2';

/** Workspace names Atlas's deploy paths create (gtmDeployService.ts). */
export const ATLAS_WORKSPACE_NAME_PREFIXES = ['Atlas Deploy', 'Atlas ·'];

export type GtmPublishRefusalCode =
  | 'NOT_ATLAS_WORKSPACE'
  | 'COMPILER_ERROR'
  | 'SYNC_CONFLICT'
  | 'NO_VERSION_CREATED'
  | 'LIVE_VERSION_CHANGED';

export class GtmPublishRefused extends Error {
  constructor(public readonly code: GtmPublishRefusalCode, message: string) {
    super(message);
    this.name = 'GtmPublishRefused';
  }
}

interface ContainerVersionLite { containerVersionId?: string; fingerprint?: string; name?: string }

async function gtmRequest<T>(accessToken: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${GTM_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    throw new Error(`GTM API ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function isAtlasWorkspaceName(name: string | undefined): boolean {
  return !!name && ATLAS_WORKSPACE_NAME_PREFIXES.some((p) => name.startsWith(p));
}

export async function getLiveVersionId(accessToken: string, accountId: string, containerId: string): Promise<string | null> {
  const live = await gtmRequest<ContainerVersionLite>(accessToken, 'GET', `/accounts/${accountId}/containers/${containerId}/versions:live`);
  return live?.containerVersionId ?? null;
}

export interface PublishInput {
  accessToken: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  versionName?: string;
  notes?: string;
}

export interface PublishOutcome {
  published_version_id: string;
  previous_version_id: string | null;
}

export async function publishAtlasWorkspace(input: PublishInput): Promise<PublishOutcome> {
  const { accessToken, accountId, containerId, workspaceId } = input;
  const base = `/accounts/${accountId}/containers/${containerId}`;

  const workspace = await gtmRequest<{ name?: string }>(accessToken, 'GET', `${base}/workspaces/${workspaceId}`);
  if (!workspace || !isAtlasWorkspaceName(workspace.name)) {
    throw new GtmPublishRefused('NOT_ATLAS_WORKSPACE', 'Only a workspace Atlas created can be published from Atlas. Publish other workspaces in Tag Manager.');
  }

  // Read before anything changes: this is the rollback target.
  const previous = await getLiveVersionId(accessToken, accountId, containerId);

  const created = await gtmRequest<{
    containerVersion?: ContainerVersionLite; compilerError?: boolean; syncStatus?: { mergeConflict?: boolean; syncError?: boolean };
  }>(accessToken, 'POST', `${base}/workspaces/${workspaceId}:create_version`, {
    name: input.versionName ?? `Atlas publish — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    notes: input.notes ?? 'Published from Atlas after explicit confirmation.',
  });
  if (created?.compilerError) throw new GtmPublishRefused('COMPILER_ERROR', 'Tag Manager reports compiler errors in this workspace. Nothing was published.');
  if (created?.syncStatus?.mergeConflict || created?.syncStatus?.syncError) {
    throw new GtmPublishRefused('SYNC_CONFLICT', 'This workspace has a sync conflict with the live container. Resolve it in Tag Manager. Nothing was published.');
  }
  const version = created?.containerVersion;
  if (!version?.containerVersionId) throw new GtmPublishRefused('NO_VERSION_CREATED', 'Tag Manager did not create a version. Nothing was published.');

  const fp = version.fingerprint ? `?fingerprint=${encodeURIComponent(version.fingerprint)}` : '';
  const published = await gtmRequest<{ compilerError?: boolean }>(accessToken, 'POST', `${base}/versions/${version.containerVersionId}:publish${fp}`);
  if (published?.compilerError) throw new GtmPublishRefused('COMPILER_ERROR', 'Tag Manager reports compiler errors in this version. It was not published.');

  return { published_version_id: version.containerVersionId, previous_version_id: previous };
}

/**
 * Re-publishes a previously live version. Refuses when the live version is no
 * longer the one being rolled back — someone published since, and Atlas must
 * not silently overwrite that.
 */
export async function republishVersion(args: {
  accessToken: string; accountId: string; containerId: string;
  versionId: string; expectedLiveVersionId: string;
}): Promise<{ previous_version_id: string | null }> {
  const { accessToken, accountId, containerId, versionId, expectedLiveVersionId } = args;
  const live = await getLiveVersionId(accessToken, accountId, containerId);
  if (live !== expectedLiveVersionId) {
    throw new GtmPublishRefused('LIVE_VERSION_CHANGED', 'The live container version is no longer the one Atlas published, so it was not rolled back. Review the live version in Tag Manager.');
  }
  const published = await gtmRequest<{ compilerError?: boolean }>(accessToken, 'POST', `/accounts/${accountId}/containers/${containerId}/versions/${versionId}:publish`);
  if (published?.compilerError) throw new GtmPublishRefused('COMPILER_ERROR', 'Tag Manager reports compiler errors in the previous version. Nothing was changed.');
  return { previous_version_id: live };
}
