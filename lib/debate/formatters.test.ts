import { describe, it, expect } from 'vitest';
import { formatDebateMarkdown } from './formatters.js';
import type { DebateSession } from './types.js';

function makeMinimalSession(content: string): DebateSession {
  return {
    id: 'test-session',
    title: 'Test Debate',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    phase: 'debate',
    active_povers: ['accelerationist', 'safetyist'],
    topic: { original: 'Test topic', refined: null, final: 'Test topic' },
    transcript: [
      {
        id: 't1',
        timestamp: '2026-01-01T00:00:01Z',
        type: 'statement',
        speaker: 'accelerationist',
        content,
        taxonomy_refs: [],
      },
    ],
  } as unknown as DebateSession;
}

describe('formatDebateMarkdown — @ and backslash escaping (sec fix t/2018)', () => {
  it('escapes @ so pandoc does not treat it as a citation', () => {
    const out = formatDebateMarkdown(makeMinimalSession('Hello @world'));
    expect(out).toContain('Hello \\@world');
  });

  it('escapes backslash before @ so the escape is not itself interpreted', () => {
    // Before fix: '\@something' → '\@something' (backslash went unescaped,
    // leaving the escape sequence unprotected if pandoc re-processes)
    // After fix: '\@something' → '\\\\@something' (both chars escaped)
    const out = formatDebateMarkdown(makeMinimalSession('\\@something'));
    expect(out).toContain('\\\\\\@something');
  });

  it('escapes backslash not followed by @ (plain backslash in content)', () => {
    const out = formatDebateMarkdown(makeMinimalSession('path\\to\\file'));
    expect(out).toContain('path\\\\to\\\\file');
  });

  it('handles content with no @ and no backslash unchanged', () => {
    const out = formatDebateMarkdown(makeMinimalSession('no special chars'));
    expect(out).toContain('no special chars');
  });
});
