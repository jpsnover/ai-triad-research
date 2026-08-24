// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2986 — the community-submit IPC validator rejected type:'oped' (enum was only
// ['chat','debate']) while the client bridge type + server already accepted 'oped',
// so every op-ed → community share failed at the IPC boundary. This locks the
// runtime enum to the full contract so the drift can't recur.

import { describe, it, expect } from 'vitest';
import { communitySubmitPayloadSchema, COMMUNITY_SUBMISSION_TYPES } from './communitySubmitSchema';

describe('community-submit payload schema (t/2986)', () => {
  it.each(['chat', 'debate', 'oped'] as const)('accepts type=%s', (type) => {
    expect(communitySubmitPayloadSchema.safeParse({ type, data: {}, note: 'x' }).success).toBe(true);
  });

  it("accepts 'oped' — the type the op-ed share sends (regression for t/2986)", () => {
    expect(communitySubmitPayloadSchema.safeParse({ type: 'oped', data: { foo: 1 } }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const r = communitySubmitPayloadSchema.safeParse({ type: 'bogus', data: {} });
    expect(r.success).toBe(false);
  });

  it('note is optional; data is required', () => {
    expect(communitySubmitPayloadSchema.safeParse({ type: 'chat', data: {} }).success).toBe(true);
    expect(communitySubmitPayloadSchema.safeParse({ type: 'chat' }).success).toBe(false);
  });

  it('the enum is exactly the client bridge contract (chat|debate|oped)', () => {
    expect([...COMMUNITY_SUBMISSION_TYPES]).toEqual(['chat', 'debate', 'oped']);
  });
});
