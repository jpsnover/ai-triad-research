import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listFeedback, isFeedbackCategory, FEEDBACK_CATEGORIES } from '../storage/feedbackStore';

let dir: string;

function writeEntry(name: string, entry: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(entry, null, 2));
}

describe('isFeedbackCategory', () => {
  it('accepts every valid category', () => {
    for (const c of FEEDBACK_CATEGORIES) expect(isFeedbackCategory(c)).toBe(true);
  });

  it('rejects unknown / non-string values', () => {
    expect(isFeedbackCategory('nonsense')).toBe(false);
    expect(isFeedbackCategory('')).toBe(false);
    expect(isFeedbackCategory(undefined)).toBe(false);
    expect(isFeedbackCategory(null)).toBe(false);
    expect(isFeedbackCategory(3)).toBe(false);
  });
});

describe('listFeedback', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty page when the directory does not exist', () => {
    const page = listFeedback(path.join(dir, 'nope'));
    expect(page).toEqual({ items: [], total: 0, hasMore: false, skipped: [] });
  });

  it('returns an empty page when the directory is empty', () => {
    expect(listFeedback(dir).total).toBe(0);
  });

  it('only reads feedback-*.json files', () => {
    writeEntry('feedback-1', { id: '1', timestamp: '2026-01-01T00:00:00Z', rating: 'up' });
    writeEntry('error-1', { id: 'x', timestamp: '2026-01-02T00:00:00Z', rating: 'down' });
    fs.writeFileSync(path.join(dir, 'feedback-2.txt'), 'not json');
    const page = listFeedback(dir);
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('1');
  });

  it('defaults a missing category to "general" (backwards-compat)', () => {
    writeEntry('feedback-old', { id: 'old', timestamp: '2026-01-01T00:00:00Z', rating: 'up' });
    writeEntry('feedback-null', { id: 'n', timestamp: '2026-01-02T00:00:00Z', rating: 'up', category: null });
    const page = listFeedback(dir);
    expect(page.items.every(e => e.category === 'general')).toBe(true);
  });

  it('preserves an existing category', () => {
    writeEntry('feedback-bug', { id: 'b', timestamp: '2026-01-01T00:00:00Z', rating: 'down', category: 'bug' });
    expect(listFeedback(dir).items[0].category).toBe('bug');
  });

  it('sorts newest first by timestamp', () => {
    writeEntry('feedback-a', { id: 'a', timestamp: '2026-01-01T00:00:00Z', rating: 'up' });
    writeEntry('feedback-b', { id: 'b', timestamp: '2026-03-01T00:00:00Z', rating: 'up' });
    writeEntry('feedback-c', { id: 'c', timestamp: '2026-02-01T00:00:00Z', rating: 'up' });
    const ids = listFeedback(dir).items.map(e => e.id);
    expect(ids).toEqual(['b', 'c', 'a']);
  });

  it('filters by category', () => {
    writeEntry('feedback-1', { id: '1', timestamp: '2026-01-01T00:00:00Z', rating: 'up', category: 'bug' });
    writeEntry('feedback-2', { id: '2', timestamp: '2026-01-02T00:00:00Z', rating: 'up', category: 'feature_request' });
    const page = listFeedback(dir, { category: 'bug' });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('1');
  });

  it('filters by rating', () => {
    writeEntry('feedback-1', { id: '1', timestamp: '2026-01-01T00:00:00Z', rating: 'up' });
    writeEntry('feedback-2', { id: '2', timestamp: '2026-01-02T00:00:00Z', rating: 'down' });
    const page = listFeedback(dir, { rating: 'down' });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('2');
  });

  it('combines category + rating filters', () => {
    writeEntry('feedback-1', { id: '1', timestamp: '2026-01-01T00:00:00Z', rating: 'up', category: 'bug' });
    writeEntry('feedback-2', { id: '2', timestamp: '2026-01-02T00:00:00Z', rating: 'down', category: 'bug' });
    const page = listFeedback(dir, { category: 'bug', rating: 'down' });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('2');
  });

  it('paginates with limit/offset and reports total + hasMore', () => {
    for (let i = 0; i < 5; i++) {
      writeEntry(`feedback-${i}`, { id: String(i), timestamp: `2026-01-0${i + 1}T00:00:00Z`, rating: 'up' });
    }
    const first = listFeedback(dir, { limit: 2, offset: 0 });
    expect(first.items.map(e => e.id)).toEqual(['4', '3']); // newest first
    expect(first.total).toBe(5);
    expect(first.hasMore).toBe(true);

    const last = listFeedback(dir, { limit: 2, offset: 4 });
    expect(last.items.map(e => e.id)).toEqual(['0']);
    expect(last.hasMore).toBe(false);
  });

  it('clamps limit to [1, 200] and offset to >= 0, defaulting on NaN', () => {
    for (let i = 0; i < 3; i++) {
      writeEntry(`feedback-${i}`, { id: String(i), timestamp: `2026-01-0${i + 1}T00:00:00Z`, rating: 'up' });
    }
    // NaN (e.g. from parseInt('')) → defaults: limit 50, offset 0.
    expect(listFeedback(dir, { limit: NaN, offset: NaN }).items).toHaveLength(3);
    // Over-large limit is clamped but still returns all 3.
    expect(listFeedback(dir, { limit: 9999 }).items).toHaveLength(3);
    // limit below 1 is clamped up to 1.
    expect(listFeedback(dir, { limit: 0 }).items).toHaveLength(1);
    // Negative offset clamps to 0.
    expect(listFeedback(dir, { offset: -5 }).total).toBe(3);
  });

  it('skips unparseable files and reports them in `skipped`', () => {
    writeEntry('feedback-ok', { id: 'ok', timestamp: '2026-01-01T00:00:00Z', rating: 'up' });
    fs.writeFileSync(path.join(dir, 'feedback-bad.json'), '{ not valid json');
    const page = listFeedback(dir);
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe('ok');
    expect(page.skipped).toEqual(['feedback-bad.json']);
  });
});
