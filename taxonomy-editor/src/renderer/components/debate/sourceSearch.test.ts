// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { splitSentences, wildcardToRegex } from './sourceSearch';

describe('splitSentences', () => {
  it('splits text into sentences, skipping fragments ≤10 chars', () => {
    const out = splitSentences('This is the first sentence. And here is a second one! Ok.');
    expect(out.map(s => s.text)).toEqual([
      'This is the first sentence.',
      'And here is a second one!',
    ]); // "Ok." is ≤10 chars → skipped
  });

  it('records the start offset of the first sentence', () => {
    expect(splitSentences('Hello there world today.')[0].start).toBe(0);
  });

  it('returns empty when there is no sentence punctuation', () => {
    expect(splitSentences('no terminator here')).toEqual([]);
  });
});

describe('wildcardToRegex', () => {
  it('translates * to .* and ? to a single char', () => {
    const re = wildcardToRegex('foo*bar?');
    expect(re).not.toBeNull();
    expect('fooXXXbarZ'.match(re!)).not.toBeNull();
  });

  it('produces a global, case-insensitive regex', () => {
    const re = wildcardToRegex('cat')!;
    expect(re.flags).toContain('i');
    expect(re.flags).toContain('g');
  });

  it('escapes regex special chars so "." is literal, not any-char', () => {
    expect(wildcardToRegex('a.b')!.test('a.b')).toBe(true);
    expect(wildcardToRegex('a.b')!.test('aXb')).toBe(false);
  });
});
