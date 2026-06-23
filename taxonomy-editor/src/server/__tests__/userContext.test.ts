// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { deriveStorageUserId } from '../userContext.js';

describe('deriveStorageUserId', () => {
  it('returns _local for empty principal', () => {
    expect(deriveStorageUserId('', 'github')).toBe('_local');
  });

  it('returns _local for the _local sentinel', () => {
    expect(deriveStorageUserId('_local', 'github')).toBe('_local');
  });

  it('lowercases a GitHub username', () => {
    expect(deriveStorageUserId('JpSnover', 'github')).toBe('jpsnover');
  });

  it('passes through an already-lowercase GitHub username', () => {
    expect(deriveStorageUserId('jpsnover', 'github')).toBe('jpsnover');
  });

  it('normalizes a Google email', () => {
    expect(deriveStorageUserId('jsnover13@gmail.com', 'google')).toBe('jsnover13-at-gmail-com');
  });

  it('normalizes an AAD email', () => {
    expect(deriveStorageUserId('jeff@contoso.com', 'aad')).toBe('jeff-at-contoso-com');
  });

  it('normalizes a multi-dot email', () => {
    expect(deriveStorageUserId('first.last@sub.domain.com', 'google')).toBe('first-last-at-sub-domain-com');
  });

  it('lowercases mixed-case emails', () => {
    expect(deriveStorageUserId('Jeff.Snover@Example.COM', 'aad')).toBe('jeff-snover-at-example-com');
  });

  it('is deterministic', () => {
    const a = deriveStorageUserId('Test@Example.com', 'google');
    const b = deriveStorageUserId('Test@Example.com', 'google');
    expect(a).toBe(b);
  });

  it('treats unknown idp same as email normalization', () => {
    expect(deriveStorageUserId('user@host.org', 'unknown-idp')).toBe('user-at-host-org');
  });

  // t/850: defense-in-depth — the result is used as a directory segment, so it
  // must never contain path separators, traversal, or null bytes.
  it('strips path separators, traversal, and null bytes (t/850)', () => {
    expect(deriveStorageUserId('a/b', 'github')).toBe('ab');
    expect(deriveStorageUserId('a\\b', 'github')).toBe('ab');
    expect(deriveStorageUserId('..', 'github')).toBe('_local');     // emptied → fallback
    expect(deriveStorageUserId('../../etc', 'github')).toBe('etc'); // traversal stripped
    expect(deriveStorageUserId('a\x00b', 'github')).toBe('ab');     // null byte
    expect(deriveStorageUserId('e/../v@x.com', 'google')).not.toMatch(/[/\\]/);
  });
});
