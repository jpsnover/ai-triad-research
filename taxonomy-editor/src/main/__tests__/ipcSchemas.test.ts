// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { NodeId, NodeDeleteLogEntrySchema } from '../ipcSchemas.js';

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

  it('accepts pov-category and pol- ids', () => {
    for (const id of ['acc-belief-001', 'saf-desires-042', 'pol-007']) {
      expect(NodeId.safeParse(id).success).toBe(true);
    }
  });

  it('Phase 2: cc- is no longer accepted (migrated to sit-)', () => {
    expect(NodeId.safeParse('cc-001').success).toBe(false);
    expect(NodeId.safeParse('cc-446').success).toBe(false);
  });

  it('rejects malformed ids', () => {
    for (const id of ['sit-4460', 'sit-44', 'sit446', 'SIT-446', 'sit-abc', 'random', '']) {
      expect(NodeId.safeParse(id).success).toBe(false);
    }
  });
});

describe('NodeDeleteLogEntrySchema (t/3859 IPC boundary validation)', () => {
  const valid = {
    nodeId: 'acc-intentions-003', pov: 'accelerationist', label: 'Example', user: 'jsnover',
    danglingEdges: 194, danglingSituationRefs: 22, danglingChildren: 0,
  };

  it('accepts a well-formed entry', () => {
    expect(NodeDeleteLogEntrySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts zero dangling counts (a delete with no references is still a valid entry)', () => {
    expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, danglingEdges: 0, danglingSituationRefs: 0, danglingChildren: 0 }).success).toBe(true);
  });

  it('accepts a situation-node pov value (not in the stricter VALID_POV enum shape callers use elsewhere)', () => {
    expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, pov: 'situations' }).success).toBe(true);
  });

  it('rejects missing or empty-string required fields', () => {
    for (const field of ['nodeId', 'pov', 'label', 'user']) {
      expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, [field]: '' }).success, `empty ${field}`).toBe(false);
      const { [field]: _omit, ...rest } = valid as Record<string, unknown>;
      expect(NodeDeleteLogEntrySchema.safeParse(rest).success, `missing ${field}`).toBe(false);
    }
  });

  it('rejects negative or non-integer dangling counts', () => {
    for (const field of ['danglingEdges', 'danglingSituationRefs', 'danglingChildren']) {
      expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, [field]: -1 }).success, `negative ${field}`).toBe(false);
      expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, [field]: 1.5 }).success, `non-integer ${field}`).toBe(false);
    }
  });

  it('rejects wrong types (e.g. a count sent as a string)', () => {
    expect(NodeDeleteLogEntrySchema.safeParse({ ...valid, danglingEdges: '194' }).success).toBe(false);
  });
});
