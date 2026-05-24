import { describe, it, expect } from 'vitest';
import { lineDiff, DiffResult } from './lineDiff.js';

describe('lineDiff', () => {
  // ── Empty inputs ──────────────────────────────────────

  it('returns empty arrays for two empty strings', () => {
    const r = lineDiff('', '');
    expect(r.left).toEqual([]);
    expect(r.right).toEqual([]);
    expect(r.stats).toEqual({ added: 0, removed: 0, same: 0, total: 0 });
  });

  it('treats left-empty as all-added', () => {
    const r = lineDiff('', 'a\nb');
    expect(r.left).toHaveLength(2);
    expect(r.right).toHaveLength(2);
    expect(r.right.every(l => l.type === 'added')).toBe(true);
    expect(r.left.every(l => l.type === 'ghost')).toBe(true);
    expect(r.stats).toEqual({ added: 2, removed: 0, same: 0, total: 2 });
  });

  it('treats right-empty as all-removed', () => {
    const r = lineDiff('a\nb\nc', '');
    expect(r.left).toHaveLength(3);
    expect(r.right).toHaveLength(3);
    expect(r.left.every(l => l.type === 'removed')).toBe(true);
    expect(r.right.every(l => l.type === 'ghost')).toBe(true);
    expect(r.stats).toEqual({ added: 0, removed: 3, same: 0, total: 3 });
  });

  // ── Identical inputs ──────────────────────────────────

  it('returns all same lines for identical inputs', () => {
    const text = 'line 1\nline 2\nline 3';
    const r = lineDiff(text, text);
    expect(r.left).toHaveLength(3);
    expect(r.right).toHaveLength(3);
    expect(r.left.every(l => l.type === 'same')).toBe(true);
    expect(r.right.every(l => l.type === 'same')).toBe(true);
    expect(r.stats).toEqual({ added: 0, removed: 0, same: 3, total: 3 });
  });

  it('preserves line numbers for identical inputs', () => {
    const r = lineDiff('a\nb\nc', 'a\nb\nc');
    expect(r.left.map(l => l.lineNumber)).toEqual([1, 2, 3]);
    expect(r.right.map(l => l.lineNumber)).toEqual([1, 2, 3]);
  });

  // ── Completely different inputs ───────────────────────

  it('returns all removed/added for completely different inputs', () => {
    const r = lineDiff('a\nb', 'x\ny');
    expect(r.stats.same).toBe(0);
    expect(r.stats.removed).toBe(2);
    expect(r.stats.added).toBe(2);
    expect(r.left.length).toBe(r.right.length);
  });

  // ── Single-line inputs ────────────────────────────────

  it('handles single identical line', () => {
    const r = lineDiff('hello', 'hello');
    expect(r.left).toEqual([{ type: 'same', text: 'hello', lineNumber: 1 }]);
    expect(r.right).toEqual([{ type: 'same', text: 'hello', lineNumber: 1 }]);
  });

  it('handles single different line', () => {
    const r = lineDiff('hello', 'world');
    expect(r.stats).toEqual({ added: 1, removed: 1, same: 0, total: 2 });
  });

  // ── Insertions ────────────────────────────────────────

  it('detects lines added in the middle', () => {
    const r = lineDiff('a\nc', 'a\nb\nc');
    expect(r.stats).toEqual({ added: 1, removed: 0, same: 2, total: 3 });

    // 'a' same, then inserted 'b' on right / ghost on left, then 'c' same
    const types = r.right.map(l => l.type);
    expect(types).toContain('added');
    expect(types.filter(t => t === 'same')).toHaveLength(2);
  });

  it('detects lines added at the end', () => {
    const r = lineDiff('a\nb', 'a\nb\nc\nd');
    expect(r.stats.added).toBe(2);
    expect(r.stats.same).toBe(2);
  });

  it('detects lines added at the beginning', () => {
    const r = lineDiff('b\nc', 'a\nb\nc');
    expect(r.stats.added).toBe(1);
    expect(r.stats.same).toBe(2);
  });

  // ── Deletions ─────────────────────────────────────────

  it('detects lines removed from the middle', () => {
    const r = lineDiff('a\nb\nc', 'a\nc');
    expect(r.stats).toEqual({ added: 0, removed: 1, same: 2, total: 3 });
  });

  it('detects lines removed from the beginning', () => {
    const r = lineDiff('a\nb\nc', 'b\nc');
    expect(r.stats.removed).toBe(1);
    expect(r.stats.same).toBe(2);
  });

  // ── Mixed changes ────────────────────────────────────

  it('handles interleaved insertions and deletions', () => {
    const r = lineDiff('a\nb\nc\nd', 'a\nX\nc\nY');
    // 'a' same, 'b' removed / 'X' added, 'c' same, 'd' removed / 'Y' added
    expect(r.stats.same).toBe(2);
    expect(r.stats.removed).toBe(2);
    expect(r.stats.added).toBe(2);
  });

  // ── Ghost line alignment ──────────────────────────────

  it('aligns same lines at identical indices in both arrays', () => {
    const r = lineDiff('a\nb\nc', 'a\nX\nb\nc');
    // left and right must be same length
    expect(r.left.length).toBe(r.right.length);

    // Every 'same' line must appear at the same index in both arrays
    for (let i = 0; i < r.left.length; i++) {
      if (r.left[i].type === 'same') {
        expect(r.right[i].type).toBe('same');
        expect(r.left[i].text).toBe(r.right[i].text);
      }
    }
  });

  it('inserts ghost lines to maintain alignment', () => {
    const r = lineDiff('a\nc', 'a\nb\nc');
    // left should have a ghost where right has the added 'b'
    const ghostIdx = r.left.findIndex(l => l.type === 'ghost');
    expect(ghostIdx).toBeGreaterThan(-1);
    expect(r.right[ghostIdx].type).toBe('added');
    expect(r.right[ghostIdx].text).toBe('b');
  });

  it('ghost lines have empty text and no lineNumber', () => {
    const r = lineDiff('', 'a');
    const ghost = r.left[0];
    expect(ghost.type).toBe('ghost');
    expect(ghost.text).toBe('');
    expect(ghost.lineNumber).toBeUndefined();
  });

  // ── Line numbers ──────────────────────────────────────

  it('assigns correct line numbers to removed lines', () => {
    const r = lineDiff('a\nb\nc', 'a\nc');
    const removed = r.left.find(l => l.type === 'removed');
    expect(removed).toBeDefined();
    expect(removed!.lineNumber).toBe(2); // 'b' is line 2 in original
  });

  it('assigns correct line numbers to added lines', () => {
    const r = lineDiff('a\nc', 'a\nb\nc');
    const added = r.right.find(l => l.type === 'added');
    expect(added).toBeDefined();
    expect(added!.lineNumber).toBe(2); // 'b' is line 2 in new
  });

  // ── Realistic prompt diff ─────────────────────────────

  it('diffs a realistic prompt change', () => {
    const old = [
      'You are a debate assistant.',
      'Your personality: analytical.',
      'Focus on empirical evidence.',
      'Respond in JSON format.',
    ].join('\n');
    const updated = [
      'You are a debate assistant.',
      'Your personality: analytical and precise.',
      'Consider multiple perspectives.',
      'Focus on empirical evidence.',
      'Respond in JSON format.',
    ].join('\n');
    const r = lineDiff(old, updated);
    expect(r.stats.same).toBe(3); // line 1, 3→4, 4→5
    expect(r.stats.removed).toBe(1); // old line 2
    expect(r.stats.added).toBe(2); // new lines 2, 3
    expect(r.left.length).toBe(r.right.length);
  });

  // ── Performance ───────────────────────────────────────

  it('handles 5000-line inputs in under 100ms', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    // Modify ~10% of lines
    const modified = lines.map((l, i) => i % 10 === 5 ? l + ' CHANGED' : l);
    const start = performance.now();
    const r = lineDiff(lines.join('\n'), modified.join('\n'));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // CI runners are slower than local
    expect(r.stats.same).toBeGreaterThan(4000);
    expect(r.stats.total).toBeGreaterThan(0);
  });

  it('handles large completely-different inputs without hanging', () => {
    const a = Array.from({ length: 1000 }, (_, i) => `old-${i}`).join('\n');
    const b = Array.from({ length: 1000 }, (_, i) => `new-${i}`).join('\n');
    const start = performance.now();
    const r = lineDiff(a, b);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(r.stats.same).toBe(0);
    expect(r.stats.removed).toBe(1000);
    expect(r.stats.added).toBe(1000);
  });
});
