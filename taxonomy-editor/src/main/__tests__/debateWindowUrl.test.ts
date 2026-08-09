// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/2399 — covers buildDebateHash URL construction.
 * TL condition: verify the Electron hash URL carries source= through to parseDebateHash.
 */

import { describe, it, expect } from 'vitest';
import { buildDebateHash } from '../debateWindowUtils.js';

describe('buildDebateHash', () => {
  it('omits source param when not provided', () => {
    expect(buildDebateHash('abc123')).toBe('debate-window?id=abc123');
  });

  it('appends &source=community for community debates', () => {
    expect(buildDebateHash('abc123', 'community')).toBe('debate-window?id=abc123&source=community');
  });

  it('percent-encodes a debateId with special characters', () => {
    expect(buildDebateHash('id with spaces')).toBe('debate-window?id=id%20with%20spaces');
  });

  it('percent-encodes source values', () => {
    expect(buildDebateHash('abc', 'a b')).toBe('debate-window?id=abc&source=a%20b');
  });
});
