// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import {
  chatToMarkdown,
  chatToText,
  chatToJson,
  chatExportFilename,
  type ChatExportEntry,
  type ChatExportOptions,
} from '../chatExportFormatters.js';

const OPTS: ChatExportOptions = {
  title: 'Test Chat',
  mode: 'brainstorm',
  pov: 'safetyist',
};

const ENTRIES: ChatExportEntry[] = [
  {
    id: 'e1',
    timestamp: '2026-01-01T10:00:00.000Z',
    speaker: 'user',
    content: 'Hello world',
    taxonomy_refs: [],
  },
  {
    id: 'e2',
    timestamp: '2026-01-01T10:01:00.000Z',
    speaker: 'safetyist',
    content: 'AI safety matters.',
    taxonomy_refs: [{ node_id: 'saf-bel-001', label: 'Risk', relevance: 'high' }],
  },
];

describe('chatToMarkdown', () => {
  it('includes title and perspective', () => {
    const out = chatToMarkdown(ENTRIES, OPTS);
    expect(out).toContain('# Test Chat');
    expect(out).toContain('Safetyist');
    expect(out).toContain('Brainstorm');
  });

  it('includes speaker content', () => {
    const out = chatToMarkdown(ENTRIES, OPTS);
    expect(out).toContain('Hello world');
    expect(out).toContain('AI safety matters.');
  });

  it('includes taxonomy refs', () => {
    const out = chatToMarkdown(ENTRIES, OPTS);
    expect(out).toContain('saf-bel-001');
  });
});

describe('chatToText', () => {
  it('includes title and perspective', () => {
    const out = chatToText(ENTRIES, OPTS);
    expect(out).toContain('Test Chat');
    expect(out).toContain('Safetyist');
  });

  it('includes speaker content', () => {
    const out = chatToText(ENTRIES, OPTS);
    expect(out).toContain('Hello world');
    expect(out).toContain('AI safety matters.');
  });
});

describe('chatToJson', () => {
  it('produces valid JSON', () => {
    const out = chatToJson(ENTRIES, OPTS);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('includes schema version', () => {
    const parsed = JSON.parse(chatToJson(ENTRIES, OPTS));
    expect(parsed.schema).toBe('ai-triad-chat-export/1');
  });

  it('preserves title, pov, mode', () => {
    const parsed = JSON.parse(chatToJson(ENTRIES, OPTS));
    expect(parsed.title).toBe('Test Chat');
    expect(parsed.pov).toBe('safetyist');
    expect(parsed.mode).toBe('brainstorm');
  });

  it('includes exportedAt ISO timestamp', () => {
    const parsed = JSON.parse(chatToJson(ENTRIES, OPTS));
    expect(typeof parsed.exportedAt).toBe('string');
    expect(() => new Date(parsed.exportedAt)).not.toThrow();
  });

  it('preserves all message fields', () => {
    const parsed = JSON.parse(chatToJson(ENTRIES, OPTS));
    expect(parsed.messages).toHaveLength(2);
    const [m1, m2] = parsed.messages;
    expect(m1.id).toBe('e1');
    expect(m1.content).toBe('Hello world');
    expect(m2.taxonomy_refs).toHaveLength(1);
    expect(m2.taxonomy_refs[0].node_id).toBe('saf-bel-001');
  });

  it('produces pretty-printed output (indented)', () => {
    const out = chatToJson(ENTRIES, OPTS);
    expect(out).toContain('\n  ');
  });
});

describe('chatExportFilename', () => {
  it('slugifies title and appends extension', () => {
    const name = chatExportFilename('My Chat Title', 'json');
    expect(name).toMatch(/^chat-my-chat-title-\d{8}\.json$/);
  });

  it('handles empty title', () => {
    const name = chatExportFilename('', 'md');
    expect(name).toMatch(/^chat-untitled-\d{8}\.md$/);
  });
});
