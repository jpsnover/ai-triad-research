import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nodeContentHash, diffNodes, stampNodeAuthorship } from '../editMeta';

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
  });
});
