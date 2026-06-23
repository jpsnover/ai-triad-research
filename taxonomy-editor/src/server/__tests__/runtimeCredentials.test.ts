// @vitest-environment node

/**
 * t/847 — runtime GitHub credentials must be scoped per user. Previously a
 * process-global PAT meant one user's credential was used for everyone's
 * sync/PR/push (confused-deputy cross-user leak).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runWithUser, type UserContext } from '../userContext.js';
import { setRuntimeCredentials, clearRuntimeCredentials, getCredentials } from '../githubAppAuth.js';

function asUser<T>(principalName: string, fn: () => T): T {
  const ctx: UserContext = { principalName, idp: 'github', storageUserId: principalName, isAnonymous: false };
  return runWithUser(ctx, fn);
}

// Isolate from any ambient GitHub env so an unset user resolves to null.
const SAVED: Record<string, string | undefined> = {};
const ENV_KEYS = ['GITHUB_REPO', 'GITHUB_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID'];

describe('runtime credentials per-user isolation (t/847)', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) { SAVED[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  });

  it("never returns one user's runtime PAT for another user", async () => {
    asUser('alice', () => setRuntimeCredentials('alice/repo', 'tok-alice'));
    asUser('bob', () => setRuntimeCredentials('bob/repo', 'tok-bob'));

    expect(await asUser('alice', () => getCredentials())).toEqual({ repo: 'alice/repo', token: 'tok-alice', mode: 'pat' });
    expect(await asUser('bob', () => getCredentials())).toEqual({ repo: 'bob/repo', token: 'tok-bob', mode: 'pat' });
    // A user who set nothing gets null — NOT another user's credential.
    expect(await asUser('carol', () => getCredentials())).toBeNull();
  });

  it('clearRuntimeCredentials only clears the calling user', async () => {
    asUser('alice', () => setRuntimeCredentials('alice/repo', 'tok-alice'));
    asUser('bob', () => setRuntimeCredentials('bob/repo', 'tok-bob'));

    asUser('alice', () => clearRuntimeCredentials());
    expect(await asUser('alice', () => getCredentials())).toBeNull();
    expect(await asUser('bob', () => getCredentials())).toEqual({ repo: 'bob/repo', token: 'tok-bob', mode: 'pat' });
  });
});
