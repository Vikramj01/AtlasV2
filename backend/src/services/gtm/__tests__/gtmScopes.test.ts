/** GA4 Admin / L11 / Junk Gate PRD §A.6: scope verification result + what a stored grant can do. */
import { describe, it, expect } from 'vitest';
import { GTM_SCOPE, scopeCapabilities, GTM_SCOPE_EDIT_CONTAINERS, GTM_SCOPE_EDIT_VERSIONS, GTM_SCOPE_PUBLISH, GTM_SCOPE_READONLY } from '../gtmScopes';

describe('GTM scopes', () => {
  it('requests the Sprint 0-verified scopes: create_version needs edit.containerversions, publish needs publish', () => {
    expect(GTM_SCOPE_EDIT_VERSIONS).toBe('https://www.googleapis.com/auth/tagmanager.edit.containerversions');
    expect(GTM_SCOPE_PUBLISH).toBe('https://www.googleapis.com/auth/tagmanager.publish');
    expect(GTM_SCOPE.split(' ')).toEqual([GTM_SCOPE_READONLY, GTM_SCOPE_EDIT_CONTAINERS, GTM_SCOPE_EDIT_VERSIONS, GTM_SCOPE_PUBLISH]);
  });

  it('a new connection (full scope) can deploy and publish', () => {
    expect(scopeCapabilities(GTM_SCOPE)).toEqual({ can_deploy: true, can_publish: true });
  });

  it('an old-scope connection can still deploy drafts but cannot publish', () => {
    expect(scopeCapabilities(`${GTM_SCOPE_READONLY} ${GTM_SCOPE_EDIT_CONTAINERS}`)).toEqual({ can_deploy: true, can_publish: false });
  });

  it('publishing needs BOTH new scopes', () => {
    expect(scopeCapabilities(`${GTM_SCOPE_EDIT_CONTAINERS} ${GTM_SCOPE_PUBLISH}`).can_publish).toBe(false);
    expect(scopeCapabilities(`${GTM_SCOPE_EDIT_CONTAINERS} ${GTM_SCOPE_EDIT_VERSIONS}`).can_publish).toBe(false);
  });

  it('nothing granted / missing scope string can do nothing', () => {
    expect(scopeCapabilities('')).toEqual({ can_deploy: false, can_publish: false });
    expect(scopeCapabilities(undefined)).toEqual({ can_deploy: false, can_publish: false });
  });
});
