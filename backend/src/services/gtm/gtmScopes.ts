/**
 * GTM OAuth scopes and what a stored grant can do (GA4 Admin / L11 / Junk Gate
 * PRD §A.6). Verified against the live Tag Manager API v2 Discovery Document
 * (revision 20260930, PRD §12 Sprint 0):
 *   workspaces.create_version → tagmanager.edit.containerversions
 *   versions.publish          → tagmanager.publish
 * Deploying a draft needs only tagmanager.edit.containers (already held by
 * every existing connection).
 *
 * Google re-prompts for consent on a widened scope and cannot silently upgrade
 * an existing grant, so a connection authorised under the old scope set keeps
 * working for draft deploy and reports `can_publish: false`; the UI shows
 * "reconnect to enable publishing" rather than letting a publish fail.
 */
export const GTM_SCOPE_READONLY = 'https://www.googleapis.com/auth/tagmanager.readonly';
export const GTM_SCOPE_EDIT_CONTAINERS = 'https://www.googleapis.com/auth/tagmanager.edit.containers';
export const GTM_SCOPE_EDIT_VERSIONS = 'https://www.googleapis.com/auth/tagmanager.edit.containerversions';
export const GTM_SCOPE_PUBLISH = 'https://www.googleapis.com/auth/tagmanager.publish';

/** The scope string requested on a new connection. */
export const GTM_SCOPE = [GTM_SCOPE_READONLY, GTM_SCOPE_EDIT_CONTAINERS, GTM_SCOPE_EDIT_VERSIONS, GTM_SCOPE_PUBLISH].join(' ');

export interface GtmScopeCapabilities {
  can_deploy: boolean;
  can_publish: boolean;
}

/** Capabilities of a granted scope string (space-delimited, as Google returns it). */
export function scopeCapabilities(grantedScope: string | null | undefined): GtmScopeCapabilities {
  const granted = new Set((grantedScope ?? '').split(/\s+/).filter(Boolean));
  return {
    can_deploy: granted.has(GTM_SCOPE_EDIT_CONTAINERS),
    can_publish: granted.has(GTM_SCOPE_EDIT_VERSIONS) && granted.has(GTM_SCOPE_PUBLISH),
  };
}
