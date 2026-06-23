// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('providerBinding', () => {
  let tmpDir: string;
  let adminDir: string;
  let checkProviderBinding: typeof import('../providerBinding.js')['checkProviderBinding'];
  let _resetBindingsCache: typeof import('../providerBinding.js')['_resetBindingsCache'];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-binding-test-'));
    adminDir = path.join(tmpDir, 'admin');
    fs.mkdirSync(adminDir, { recursive: true });

    vi.stubEnv('AI_TRIAD_DATA_ROOT', tmpDir);
    vi.resetModules();

    const mod = await import('../providerBinding.js');
    checkProviderBinding = mod.checkProviderBinding;
    _resetBindingsCache = mod._resetBindingsCache;
    _resetBindingsCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows _local without creating a binding', () => {
    const result = checkProviderBinding('_local', 'github');
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(adminDir, 'provider_bindings.json'))).toBe(false);
  });

  it('allows empty storageUserId without creating a binding', () => {
    const result = checkProviderBinding('', 'github');
    expect(result).toEqual({ ok: true });
  });

  it('creates a binding on first login', () => {
    const result = checkProviderBinding('jpsnover', 'github');
    expect(result).toEqual({ ok: true });

    const bindings = JSON.parse(fs.readFileSync(path.join(adminDir, 'provider_bindings.json'), 'utf-8'));
    expect(bindings['jpsnover']).toBe('github');
  });

  it('allows same idp on subsequent login', () => {
    checkProviderBinding('jpsnover', 'github');
    const result = checkProviderBinding('jpsnover', 'github');
    expect(result).toEqual({ ok: true });
  });

  it('rejects a different idp for the same storageUserId', () => {
    checkProviderBinding('jpsnover', 'github');

    _resetBindingsCache();
    const result = checkProviderBinding('jpsnover', 'google');
    expect(result).toEqual({ ok: false, boundTo: 'github' });
  });

  it('tracks multiple users independently', () => {
    checkProviderBinding('jpsnover', 'github');
    checkProviderBinding('jsnover13-at-gmail-com', 'google');

    _resetBindingsCache();
    expect(checkProviderBinding('jpsnover', 'github')).toEqual({ ok: true });
    expect(checkProviderBinding('jsnover13-at-gmail-com', 'google')).toEqual({ ok: true });
    expect(checkProviderBinding('jpsnover', 'aad')).toEqual({ ok: false, boundTo: 'github' });
    expect(checkProviderBinding('jsnover13-at-gmail-com', 'aad')).toEqual({ ok: false, boundTo: 'google' });
  });

  it('persists bindings to disk and reloads after cache reset', () => {
    checkProviderBinding('alice', 'github');
    _resetBindingsCache();

    const result = checkProviderBinding('alice', 'github');
    expect(result).toEqual({ ok: true });
  });

  it('creates admin directory if it does not exist', () => {
    fs.rmSync(adminDir, { recursive: true, force: true });
    _resetBindingsCache();

    const result = checkProviderBinding('newuser', 'google');
    expect(result).toEqual({ ok: true });
    expect(fs.existsSync(path.join(adminDir, 'provider_bindings.json'))).toBe(true);
  });

  it('handles pre-existing bindings file with extra entries', () => {
    fs.writeFileSync(
      path.join(adminDir, 'provider_bindings.json'),
      JSON.stringify({ existing: 'aad', jpsnover: 'github' }),
      'utf-8',
    );
    _resetBindingsCache();

    expect(checkProviderBinding('existing', 'aad')).toEqual({ ok: true });
    expect(checkProviderBinding('existing', 'google')).toEqual({ ok: false, boundTo: 'aad' });
    expect(checkProviderBinding('jpsnover', 'github')).toEqual({ ok: true });
  });

  // The scenario this entire module prevents: two providers produce the same
  // normalized storageUserId for different real users.
  it('prevents cross-provider account collision', () => {
    // Google user "bob@example.com" → storageUserId "bob-at-example-com"
    checkProviderBinding('bob-at-example-com', 'google');

    // AAD user "bob@example.com" → same storageUserId "bob-at-example-com"
    _resetBindingsCache();
    const result = checkProviderBinding('bob-at-example-com', 'aad');
    expect(result.ok).toBe(false);
    expect(result.boundTo).toBe('google');
  });
});
