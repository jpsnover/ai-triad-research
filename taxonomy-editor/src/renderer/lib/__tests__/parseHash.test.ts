// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { parseHashParams } from '../parseHash';

describe('parseHashParams', () => {
  it('extracts params from a chat-window hash', () => {
    const params = parseHashParams('#chat-window?id=chat-123');
    expect(params.get('id')).toBe('chat-123');
  });

  it('extracts multiple params', () => {
    const params = parseHashParams('#/debate?id=abc&source=community');
    expect(params.get('id')).toBe('abc');
    expect(params.get('source')).toBe('community');
  });

  it('returns empty params for hash with no query string', () => {
    const params = parseHashParams('#chat-window');
    expect(params.get('id')).toBeNull();
    expect([...params.keys()]).toHaveLength(0);
  });

  it('returns empty params for empty string', () => {
    const params = parseHashParams('');
    expect([...params.keys()]).toHaveLength(0);
  });

  it('handles bare hash with query', () => {
    const params = parseHashParams('#?id=foo');
    expect(params.get('id')).toBe('foo');
  });

  it('handles encoded values', () => {
    const params = parseHashParams('#chat-window?id=chat%20123&title=hello%20world');
    expect(params.get('id')).toBe('chat 123');
    expect(params.get('title')).toBe('hello world');
  });
});
