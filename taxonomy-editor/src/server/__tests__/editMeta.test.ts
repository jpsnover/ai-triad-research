import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nodeContentHash, diffNodes, stampNodeAuthorship, changedFields } from '../editMeta';

vi.mock('../userContext', () => ({
  getCurrentUserId: () => 'test-user@example.com',
}));

function makeNode(id: string, label: string, extra?: Record<string, unknown>) {
  return { id, label, description: `desc-${id}`, ...extra };
}

describe('editMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('nodeContentHash', () => {
    it('returns a 16-char hex string', () => {
      const hash = nodeContentHash(makeNode('a-1', 'Alpha'));
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('produces the same hash for identical content', () => {
      const a = nodeContentHash(makeNode('a-1', 'Alpha'));
      const b = nodeContentHash(makeNode('a-1', 'Alpha'));
      expect(a).toBe(b);
    });

    it('produces different hashes for different content', () => {
      const a = nodeContentHash(makeNode('a-1', 'Alpha'));
      const b = nodeContentHash(makeNode('a-1', 'Beta'));
      expect(a).not.toBe(b);
    });

    it('ignores _edit_meta when hashing', () => {
      const base = makeNode('a-1', 'Alpha');
      const withMeta = {
        ...base,
        _edit_meta: { last_edited_by: 'someone', last_edited_at: '2026-01-01' },
      };
      expect(nodeContentHash(base)).toBe(nodeContentHash(withMeta));
    });

    it('ignores history fields when hashing', () => {
      const base = makeNode('a-1', 'Alpha');
      const withHistory = {
        ...base,
        confidence_history: [{ old: 0.5, new: 0.6 }],
        priority_history: [{ old: 1, new: 2 }],
      };
      expect(nodeContentHash(base)).toBe(nodeContentHash(withHistory));
    });
  });

  describe('diffNodes', () => {
    it('detects added nodes', () => {
      const old = [makeNode('a-1', 'Alpha')];
      const now = [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')];
      const diff = diffNodes(old, now);
      expect(diff.added).toEqual(['a-2']);
      expect(diff.modified).toEqual([]);
      expect(diff.deleted).toEqual([]);
    });

    it('detects deleted nodes', () => {
      const old = [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')];
      const now = [makeNode('a-1', 'Alpha')];
      const diff = diffNodes(old, now);
      expect(diff.deleted).toEqual(['a-2']);
      expect(diff.added).toEqual([]);
    });

    it('detects modified nodes', () => {
      const old = [makeNode('a-1', 'Alpha')];
      const now = [makeNode('a-1', 'Alpha Updated')];
      const diff = diffNodes(old, now);
      expect(diff.modified).toEqual(['a-1']);
      expect(diff.added).toEqual([]);
    });

    it('returns empty diff for identical arrays', () => {
      const nodes = [makeNode('a-1', 'Alpha'), makeNode('a-2', 'Beta')];
      const diff = diffNodes(nodes, [...nodes]);
      expect(diff.added).toEqual([]);
      expect(diff.modified).toEqual([]);
      expect(diff.deleted).toEqual([]);
    });
  });

  describe('stampNodeAuthorship', () => {
    it('stamps new nodes with created_by and last_edited_by', () => {
      const result = stampNodeAuthorship([], [makeNode('a-1', 'Alpha')]);
      expect(result[0]._edit_meta).toEqual({
        last_edited_by: 'test-user@example.com',
        last_edited_at: '2026-06-16T12:00:00.000Z',
        created_by: 'test-user@example.com',
        created_at: '2026-06-16T12:00:00.000Z',
      });
    });

    it('preserves created_by on modified nodes', () => {
      const old = [{
        ...makeNode('a-1', 'Alpha'),
        _edit_meta: {
          last_edited_by: 'original@test.com',
          last_edited_at: '2026-01-01T00:00:00Z',
          created_by: 'creator@test.com',
          created_at: '2025-12-01T00:00:00Z',
        },
      }];
      const now = [makeNode('a-1', 'Alpha Updated')];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_meta!.created_by).toBe('creator@test.com');
      expect(result[0]._edit_meta!.created_at).toBe('2025-12-01T00:00:00Z');
      expect(result[0]._edit_meta!.last_edited_by).toBe('test-user@example.com');
    });

    it('does not touch unchanged nodes', () => {
      const old = [makeNode('a-1', 'Alpha')];
      const now = [makeNode('a-1', 'Alpha')];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_meta).toBeUndefined();
    });

    it('accepts an explicit userId override', () => {
      const result = stampNodeAuthorship([], [makeNode('a-1', 'A')], 'custom-user');
      expect(result[0]._edit_meta!.last_edited_by).toBe('custom-user');
      expect(result[0]._edit_meta!.created_by).toBe('custom-user');
    });

    it('appends edit history for new nodes with wildcard fields', () => {
      const result = stampNodeAuthorship([], [makeNode('a-1', 'Alpha')]);
      expect(result[0]._edit_history).toHaveLength(1);
      expect(result[0]._edit_history![0]).toEqual({
        user: 'test-user@example.com',
        timestamp: '2026-06-16T12:00:00.000Z',
        fields_changed: ['*'],
      });
    });

    it('appends edit history with changed field names for modified nodes', () => {
      const old = [makeNode('a-1', 'Alpha')];
      const now = [makeNode('a-1', 'Alpha Updated', { description: 'new desc' })];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_history).toHaveLength(1);
      expect(result[0]._edit_history![0].fields_changed).toContain('label');
      expect(result[0]._edit_history![0].fields_changed).toContain('description');
    });

    it('preserves and appends to existing edit history', () => {
      const existingHistory = [
        { user: 'prev@test.com', timestamp: '2026-01-01T00:00:00Z', fields_changed: ['label'] },
      ];
      const old = [{ ...makeNode('a-1', 'Alpha'), _edit_history: existingHistory }];
      const now = [makeNode('a-1', 'Alpha Updated')];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_history).toHaveLength(2);
      expect(result[0]._edit_history![0].user).toBe('prev@test.com');
      expect(result[0]._edit_history![1].user).toBe('test-user@example.com');
    });

    it('caps edit history at 50 entries', () => {
      const existingHistory = Array.from({ length: 50 }, (_, i) => ({
        user: `user-${i}@test.com`,
        timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        fields_changed: ['label'],
      }));
      const old = [{ ...makeNode('a-1', 'Alpha'), _edit_history: existingHistory }];
      const now = [makeNode('a-1', 'Alpha Updated')];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_history).toHaveLength(50);
      expect(result[0]._edit_history![0].user).toBe('user-1@test.com');
      expect(result[0]._edit_history![49].user).toBe('test-user@example.com');
    });

    // t/828 / p/78#5: unchanged nodes whose incoming payload dropped the stamps
    // must keep the metadata already on disk (else a re-save strips prior history).
    it('preserves disk _edit_meta/_edit_history for an unchanged node missing them in the payload', () => {
      const meta = { last_edited_by: 'prev@test.com', last_edited_at: '2026-01-01T00:00:00Z' };
      const history = [{ user: 'prev@test.com', timestamp: '2026-01-01T00:00:00Z', fields_changed: ['label'] }];
      const old = [{ ...makeNode('a-1', 'Alpha'), _edit_meta: meta, _edit_history: history }];
      const now = [makeNode('a-1', 'Alpha')]; // same content, no stamps round-tripped
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_meta).toEqual(meta);
      expect(result[0]._edit_history).toEqual(history);
    });

    it('keeps payload stamps for an unchanged node that did round-trip them', () => {
      const meta = { last_edited_by: 'prev@test.com', last_edited_at: '2026-01-01T00:00:00Z' };
      const history = [{ user: 'prev@test.com', timestamp: '2026-01-01T00:00:00Z', fields_changed: ['label'] }];
      const old = [{ ...makeNode('a-1', 'Alpha'), _edit_meta: meta, _edit_history: history }];
      const now = [{ ...makeNode('a-1', 'Alpha'), _edit_meta: meta, _edit_history: history }];
      const result = stampNodeAuthorship(old, now);
      expect(result[0]._edit_history).toEqual(history);
    });

    it('repeated saves without round-tripping stamps do not strip history', () => {
      // Save 1: a-1 is edited → stamped with history.
      const disk0 = [makeNode('a-1', 'Alpha')];
      const save1Payload = [makeNode('a-1', 'Alpha Updated')];
      const afterSave1 = stampNodeAuthorship(disk0, save1Payload);
      expect(afterSave1[0]._edit_history).toHaveLength(1);

      // Saves 2 & 3: renderer re-sends the same node WITHOUT the stamps. Content
      // matches disk → "unchanged" → must NOT lose the history from save 1.
      const afterSave2 = stampNodeAuthorship(afterSave1, [makeNode('a-1', 'Alpha Updated')]);
      expect(afterSave2[0]._edit_history).toHaveLength(1);
      const afterSave3 = stampNodeAuthorship(afterSave2, [makeNode('a-1', 'Alpha Updated')]);
      expect(afterSave3[0]._edit_history).toHaveLength(1);
      expect(afterSave3[0]._edit_meta!.last_edited_by).toBe('test-user@example.com');
    });
  });

  describe('changedFields', () => {
    it('detects changed scalar fields', () => {
      const old = makeNode('a-1', 'Alpha');
      const now = makeNode('a-1', 'Beta');
      expect(changedFields(old, now)).toEqual(['label']);
    });

    it('detects multiple changed fields', () => {
      const old = makeNode('a-1', 'Alpha');
      const now = { ...makeNode('a-1', 'Beta'), description: 'changed' };
      expect(changedFields(old, now)).toEqual(['description', 'label']);
    });

    it('detects added fields', () => {
      const old = makeNode('a-1', 'Alpha');
      const now = { ...makeNode('a-1', 'Alpha'), debate_refs: ['d-1'] };
      expect(changedFields(old, now)).toEqual(['debate_refs']);
    });

    it('returns empty for identical nodes', () => {
      const node = makeNode('a-1', 'Alpha');
      expect(changedFields(node, { ...node })).toEqual([]);
    });

    it('excludes _edit_meta and history fields', () => {
      const old = makeNode('a-1', 'Alpha');
      const now = {
        ...makeNode('a-1', 'Alpha'),
        _edit_meta: { last_edited_by: 'x', last_edited_at: 'y' },
        _edit_history: [{ user: 'x', timestamp: 'y', fields_changed: [] }],
        confidence_history: [{ old: 0.5, new: 0.6 }],
      };
      expect(changedFields(old, now)).toEqual([]);
    });
  });
});
