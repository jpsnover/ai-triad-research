// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Locks the t/1791 producer (publicPovSharePath) to the t/1790 consumer
// (PublicPovView's nodeIdFromSharePath) so the share-link contract can't drift.

import { describe, it, expect } from 'vitest';
import { publicPovSharePath } from './shareLinks';
import { nodeIdFromSharePath } from '../components/PublicPovView';

describe('publicPovSharePath', () => {
  it('produces the stable /share/pov/:id path', () => {
    expect(publicPovSharePath('acc-Beliefs-001')).toBe('/share/pov/acc-Beliefs-001');
  });

  it('round-trips through the public view route matcher for every POV camp', () => {
    for (const id of ['acc-Beliefs-001', 'saf-Desires-042', 'skp-Intentions-117']) {
      expect(nodeIdFromSharePath(publicPovSharePath(id))).toBe(id);
    }
  });
});
