// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { extractSummary } from './debateIndex.js';

describe('extractSummary', () => {
  it('uses data.title when it is a string', () => {
    const result = extractSummary({
      id: 'd1',
      title: 'My Debate',
      topic: { final: 'AI governance' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).toBe('My Debate');
  });

  it('extracts title from topic object when data.title is missing', () => {
    const result = extractSummary({
      id: 'd2',
      topic: { final: 'AI safety', original: 'safety' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).toBe('AI safety');
    expect(result.title).not.toContain('[object Object]');
  });

  it('extracts title from topic.original when topic.final is missing', () => {
    const result = extractSummary({
      id: 'd3',
      topic: { original: 'Original topic' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).toBe('Original topic');
  });

  it('handles legacy string topic', () => {
    const result = extractSummary({
      id: 'd4',
      topic: 'AI regulation',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).toBe('AI regulation');
  });

  it('falls back to Untitled when no title or topic', () => {
    const result = extractSummary({
      id: 'd5',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).toBe('Untitled');
  });

  it('does not produce [object Object] when topic is an object and title is missing', () => {
    const result = extractSummary({
      id: 'd6',
      title: '',
      topic: { final: 'Correct title', original: 'backup' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [],
    });
    expect(result.title).not.toContain('[object Object]');
    expect(result.title).toBe('Correct title');
  });

  it('counts turns from transcript', () => {
    const result = extractSummary({
      id: 'd7',
      topic: { final: 'Test' },
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
      phase: 'completed',
      transcript: [
        { type: 'statement' },
        { type: 'opening' },
        { type: 'moderator_intervention' },
      ],
    });
    expect(result.turn_count).toBe(2);
  });
});
