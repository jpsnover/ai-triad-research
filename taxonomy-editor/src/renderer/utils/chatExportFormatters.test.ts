// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  chatToMarkdown,
  chatToText,
  chatToPrintHtml,
  chatExportFilename,
} from './chatExportFormatters';
import type { ChatEntry } from '../types/chat';

const FIXED_DATE = new Date('2026-07-10T14:30:00Z');

const SAMPLE_ENTRIES: ChatEntry[] = [
  {
    id: '1',
    timestamp: '2026-07-10T14:00:00Z',
    speaker: 'safetyist',
    content: 'We should consider the alignment problem carefully.',
    taxonomy_refs: [
      { node_id: 'saf-beliefs-217', label: 'Alignment is hard', relevance: 'high' },
      { node_id: 'saf-desires-003', relevance: 'medium' },
    ],
    metadata: { internal: true },
  },
  {
    id: '2',
    timestamp: '2026-07-10T14:05:00Z',
    speaker: 'system',
    content: 'Topic refined to alignment approaches.',
    taxonomy_refs: [],
  },
  {
    id: '3',
    timestamp: '2026-07-10T14:10:00Z',
    speaker: 'user',
    content: 'What about interpretability?',
    taxonomy_refs: [],
  },
];

const OPTIONS = {
  title: 'Alignment Discussion',
  mode: 'brainstorm' as const,
  pov: 'safetyist' as const,
};

describe('chatExportFormatters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chatToMarkdown', () => {
    it('includes header with title, perspective, mode, and entry count', () => {
      const md = chatToMarkdown(SAMPLE_ENTRIES, OPTIONS);
      expect(md).toContain('# Alignment Discussion');
      expect(md).toContain('Safetyist');
      expect(md).toContain('Brainstorm');
      expect(md).toContain('3 messages');
    });

    it('renders speaker headings with timestamps', () => {
      const md = chatToMarkdown(SAMPLE_ENTRIES, OPTIONS);
      expect(md).toMatch(/### Safetyist — /);
      expect(md).toMatch(/### System — /);
      expect(md).toMatch(/### User — /);
    });

    it('includes taxonomy refs as footnotes in markdown', () => {
      const md = chatToMarkdown(SAMPLE_ENTRIES, OPTIONS);
      expect(md).toContain('> refs: saf-beliefs-217 "Alignment is hard", saf-desires-003');
    });

    it('omits refs block when entry has no refs', () => {
      const md = chatToMarkdown(SAMPLE_ENTRIES, OPTIONS);
      const systemBlock = md.split('### System')[1]?.split('###')[0] ?? '';
      expect(systemBlock).not.toContain('> refs:');
    });

    it('includes footer', () => {
      const md = chatToMarkdown(SAMPLE_ENTRIES, OPTIONS);
      expect(md).toContain('Exported from AI Triad Taxonomy Editor');
    });

    it('handles empty entries', () => {
      const md = chatToMarkdown([], OPTIONS);
      expect(md).toContain('# Alignment Discussion');
      expect(md).toContain('0 messages');
    });

    it('uses singular for 1 message', () => {
      const md = chatToMarkdown([SAMPLE_ENTRIES[0]], OPTIONS);
      expect(md).toContain('1 message');
      expect(md).not.toContain('1 messages');
    });
  });

  describe('chatToText', () => {
    it('includes header with title and entry count', () => {
      const txt = chatToText(SAMPLE_ENTRIES, OPTIONS);
      expect(txt).toContain('Alignment Discussion');
      expect(txt).toContain('3 messages');
    });

    it('renders speaker names in uppercase', () => {
      const txt = chatToText(SAMPLE_ENTRIES, OPTIONS);
      expect(txt).toMatch(/SAFETYIST \(/);
      expect(txt).toMatch(/SYSTEM \(/);
      expect(txt).toMatch(/USER \(/);
    });

    it('omits taxonomy refs (per spec §2)', () => {
      const txt = chatToText(SAMPLE_ENTRIES, OPTIONS);
      expect(txt).not.toContain('saf-beliefs-217');
      expect(txt).not.toContain('refs:');
    });

    it('omits metadata', () => {
      const txt = chatToText(SAMPLE_ENTRIES, OPTIONS);
      expect(txt).not.toContain('internal');
    });

    it('includes footer', () => {
      const txt = chatToText(SAMPLE_ENTRIES, OPTIONS);
      expect(txt).toContain('Exported from AI Triad Taxonomy Editor');
    });
  });

  describe('chatToPrintHtml', () => {
    it('produces valid HTML document', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('</html>');
    });

    it('includes print styles with break-inside: avoid', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('break-inside: avoid');
    });

    it('includes camp colors on speaker headings', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('color: #dc2626');
    });

    it('marks system entries with system class', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('chat-entry-system');
    });

    it('includes taxonomy refs in PDF output', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('saf-beliefs-217');
      expect(html).toContain('Alignment is hard');
    });

    it('escapes HTML in content', () => {
      const entries: ChatEntry[] = [{
        id: '1',
        timestamp: '2026-07-10T14:00:00Z',
        speaker: 'safetyist',
        content: 'Check <script>alert("xss")</script> this',
        taxonomy_refs: [],
      }];
      const html = chatToPrintHtml(entries, OPTIONS);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('includes header metadata', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('Safetyist');
      expect(html).toContain('Brainstorm');
      expect(html).toContain('3 messages');
    });

    it('includes footer', () => {
      const html = chatToPrintHtml(SAMPLE_ENTRIES, OPTIONS);
      expect(html).toContain('chat-export-footer');
      expect(html).toContain('Exported from AI Triad Taxonomy Editor');
    });
  });

  describe('chatExportFilename', () => {
    it('generates filename with chat prefix, slug, and date', () => {
      const name = chatExportFilename('Alignment Discussion', 'md');
      expect(name).toBe('chat-alignment-discussion-20260710.md');
    });

    it('handles empty title with untitled fallback', () => {
      const name = chatExportFilename('', 'txt');
      expect(name).toBe('chat-untitled-20260710.txt');
    });

    it('truncates long titles to 60 chars', () => {
      const longTitle = 'A'.repeat(100);
      const name = chatExportFilename(longTitle, 'pdf');
      const slug = name.replace('chat-', '').replace('-20260710.pdf', '');
      expect(slug.length).toBeLessThanOrEqual(60);
    });

    it('strips special characters from slug', () => {
      const name = chatExportFilename('Hello! World? <test>', 'md');
      expect(name).toBe('chat-hello-world-test-20260710.md');
    });

    it('handles all supported extensions', () => {
      expect(chatExportFilename('Test', 'md')).toMatch(/\.md$/);
      expect(chatExportFilename('Test', 'txt')).toMatch(/\.txt$/);
      expect(chatExportFilename('Test', 'pdf')).toMatch(/\.pdf$/);
    });
  });
});
