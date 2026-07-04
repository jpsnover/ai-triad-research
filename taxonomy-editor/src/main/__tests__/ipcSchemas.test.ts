// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { NodeId } from '../ipcSchemas.js';

/**
 * cc→sit migration (t/1308 / t/1316). The IPC NodeId schema must accept the migrated
 * cross-cutting → situations range (sit-201..sit-446) OR the write would be rejected
 * over IPC in the Electron build. This asserts against the real exported schema.
 */
describe('IPC NodeId schema — cc→sit migration dual tolerance (t/1316)', () => {
  it('AC1: accepts sit-446 (top of the migrated range)', () => {
    expect(NodeId.safeParse('sit-446').success).toBe(true);
  });

  it('accepts sit- ids across the migrated range', () => {
    for (const id of ['sit-201', 'sit-300', 'sit-446']) {
      expect(NodeId.safeParse(id).success).toBe(true);
    }
  });

  it('Phase 1: retains dual tolerance — cc-, pov-category, and pol- still accepted', () => {
    for (const id of ['cc-001', 'acc-belief-001', 'saf-desires-042', 'pol-007']) {
      expect(NodeId.safeParse(id).success).toBe(true);
    }
  });

  it('rejects malformed ids', () => {
    for (const id of ['sit-4460', 'sit-44', 'sit446', 'SIT-446', 'sit-abc', 'random', '']) {
      expect(NodeId.safeParse(id).success).toBe(false);
    }
  });
});
