// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { deriveStorageUserId } from '../userContext.js';

describe('deriveStorageUserId', () => {
  it('returns _local for empty principal', () => {
    expect(deriveStorageUserId('', 'github')).toBe('_local');
  });

  it('returns _local for _local principal', () => {
    expect(deriveStorageUserId('_local', 'github')).toBe('_local');
  });

  it('lowercases GitHub usernames', () => {
    expect(deriveStorageUserId('JpSnover', 'github')).toBe('jpsnover');
  });

  it('preserves already-lowercase GitHub usernames', () => {
    expect(deriveStorageUserId('jpsnover', 'github')).toBe('jpsnover');
  });

  it('normalizes Google emails', () => {
    expect(deriveStorageUserId('jsnover13@gmail.com', 'google')).toBe('jsnover13-at-gmail-com');
  });

  it('normalizes AAD emails', () => {
    expect(deriveStorageUserId('jeff@contoso.com', 'aad')).toBe('jeff-at-contoso-com');
  });

  it('handles emails with multiple dots', () => {
    expect(deriveStorageUserId('first.last@sub.domain.com', 'google')).toBe('first-last-at-sub-domain-com');
  });

  it('handles uppercase emails', () => {
    expect(deriveStorageUserId('Jeff.Snover@Example.COM', 'aad')).toBe('jeff-snover-at-example-com');
  });

  it('is deterministic — same input always same output', () => {
    const a = deriveStorageUserId('Test@Example.com', 'google');
    const b = deriveStorageUserId('Test@Example.com', 'google');
    expect(a).toBe(b);
  });

  it('treats unknown idp same as email normalization', () => {
    expect(deriveStorageUserId('user@host.org', 'unknown-idp')).toBe('user-at-host-org');
  });
});
