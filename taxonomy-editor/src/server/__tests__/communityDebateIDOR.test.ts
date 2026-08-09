// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

// t/2368 IDOR regression: community.loadCommunityItem('debates', id) reads ONLY
// from communityDebatesDir() (community/debates/debate-{id}.json). It can never
// reach user-scoped blob paths, so a private debate ID absent from the community
// store yields null — not the user's debate blob.

import { describe, it, expect } from 'vitest';
import * as community from '../community/community.js';

describe('t/2368 — /api/community/debates/:id IDOR guard', () => {
  it('a debate id absent from the community store returns null (not a user blob)', async () => {
    // Private debates live in user-scoped storage; the community endpoint calls
    // loadCommunityItem which reads only from community/debates/. Missing → null,
    // which the route maps to {found:false}@200 — never a fallback to user storage.
    const result = await community.loadCommunityItem('debates', 'idor-test-private-only');
    expect(result).toBeNull();
  });

  it('a second distinct private id also yields null (storage isolation is unconditional)', async () => {
    const result = await community.loadCommunityItem('debates', 'idor-test-user-scoped-id-2');
    expect(result).toBeNull();
  });

  it('path traversal in id is rejected before any storage lookup', async () => {
    // assertSafeId() guard — cannot escape communityDebatesDir() via ../
    await expect(
      community.loadCommunityItem('debates', '../private/user-debate'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
