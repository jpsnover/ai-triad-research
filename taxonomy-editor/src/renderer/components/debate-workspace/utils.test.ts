// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  speakerLabel,
  speakerColor,
  STRENGTH_BAND,
  pctFmt,
  groundingLabel,
  countOccurrences,
  stripLeadingHeadings,
  fixMarkdownLinks,
  nodeIdToTab,
} from './utils';

// ── Mocks ────────────────────────────────────────────────────

vi.mock('@lib/debate/nodeIdUtils', () => ({
  nodePovFromId: (id: string) => {
    if (id.startsWith('acc-')) return 'accelerationist';
    if (id.startsWith('saf-')) return 'safetyist';
    if (id.startsWith('skp-')) return 'skeptic';
    if (id.startsWith('sit-')) return 'situations';
    return null;
  },
}));

vi.mock('@bridge', () => ({
  api: {
    focusNodeInMainWindow: vi.fn(),
    clipboardWriteText: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: {
    getState: vi.fn(() => ({ policyRegistry: [] })),
  },
}));

// POVER_INFO mock — must export same shape utils.ts reads from '../../types/debate'
vi.mock('../../types/debate', () => ({
  POVER_INFO: {
    accelerationist: { label: 'Accelerationist', color: 'var(--color-acc)' },
    safetyist: { label: 'Safetyist', color: 'var(--color-saf)' },
    skeptic: { label: 'Skeptic', color: 'var(--color-skp)' },
  },
}));

// ── speakerLabel ─────────────────────────────────────────────

describe('speakerLabel', () => {
  it('returns "System" for system speaker', () => {
    expect(speakerLabel('system')).toBe('System');
  });

  it('returns "Moderator" for moderator speaker', () => {
    expect(speakerLabel('moderator')).toBe('Moderator');
  });

  it('returns "You" for user speaker', () => {
    expect(speakerLabel('user')).toBe('You');
  });

  it('returns "Document" for document speaker', () => {
    expect(speakerLabel('document')).toBe('Document');
  });

  it('returns the POVER_INFO label for accelerationist', () => {
    expect(speakerLabel('accelerationist')).toBe('Accelerationist');
  });

  it('returns the POVER_INFO label for safetyist', () => {
    expect(speakerLabel('safetyist')).toBe('Safetyist');
  });

  it('returns the POVER_INFO label for skeptic', () => {
    expect(speakerLabel('skeptic')).toBe('Skeptic');
  });

  it('falls back to the raw speaker string when POVER_INFO has no entry', () => {
    // 'unknown' is not in the mock POVER_INFO
    expect(speakerLabel('unknown' as never)).toBe('unknown');
  });
});

// ── speakerColor ─────────────────────────────────────────────

describe('speakerColor', () => {
  it('returns undefined for system', () => {
    expect(speakerColor('system')).toBeUndefined();
  });

  it('returns undefined for user', () => {
    expect(speakerColor('user')).toBeUndefined();
  });

  it('returns undefined for document', () => {
    expect(speakerColor('document')).toBeUndefined();
  });

  it('returns the moderator CSS variable for moderator', () => {
    expect(speakerColor('moderator')).toBe('var(--color-moderator, #8b5cf6)');
  });

  it('returns the POVER_INFO color for accelerationist', () => {
    expect(speakerColor('accelerationist')).toBe('var(--color-acc)');
  });

  it('returns the POVER_INFO color for safetyist', () => {
    expect(speakerColor('safetyist')).toBe('var(--color-saf)');
  });

  it('returns the POVER_INFO color for skeptic', () => {
    expect(speakerColor('skeptic')).toBe('var(--color-skp)');
  });
});

// ── STRENGTH_BAND ────────────────────────────────────────────

describe('STRENGTH_BAND', () => {
  it('returns Strong for values >= 0.8', () => {
    expect(STRENGTH_BAND(0.8).label).toBe('Strong');
    expect(STRENGTH_BAND(1.0).label).toBe('Strong');
  });

  it('returns Moderate for values >= 0.5 and < 0.8', () => {
    expect(STRENGTH_BAND(0.5).label).toBe('Moderate');
    expect(STRENGTH_BAND(0.79).label).toBe('Moderate');
  });

  it('returns Weak for values >= 0.3 and < 0.5', () => {
    expect(STRENGTH_BAND(0.3).label).toBe('Weak');
    expect(STRENGTH_BAND(0.49).label).toBe('Weak');
  });

  it('returns Very Weak for values < 0.3', () => {
    expect(STRENGTH_BAND(0.0).label).toBe('Very Weak');
    expect(STRENGTH_BAND(0.29).label).toBe('Very Weak');
  });

  it('includes a color for each band', () => {
    expect(STRENGTH_BAND(0.9).color).toBeTruthy();
    expect(STRENGTH_BAND(0.6).color).toBeTruthy();
    expect(STRENGTH_BAND(0.4).color).toBeTruthy();
    expect(STRENGTH_BAND(0.1).color).toBeTruthy();
  });
});

// ── pctFmt ────────────────────────────────────────────────────

describe('pctFmt', () => {
  it('formats 0.5 as "50%"', () => {
    expect(pctFmt(0.5)).toBe('50%');
  });

  it('formats 1 as "100%"', () => {
    expect(pctFmt(1)).toBe('100%');
  });

  it('formats 0 as "0%"', () => {
    expect(pctFmt(0)).toBe('0%');
  });

  it('rounds to nearest integer', () => {
    expect(pctFmt(0.333)).toBe('33%');
    expect(pctFmt(0.666)).toBe('67%');
  });
});

// ── groundingLabel ───────────────────────────────────────────

describe('groundingLabel', () => {
  it('returns "Grounded" for values >= 0.65', () => {
    expect(groundingLabel(0.65)).toBe('Grounded');
    expect(groundingLabel(1.0)).toBe('Grounded');
  });

  it('returns "Reasoned" for values >= 0.35 and < 0.65', () => {
    expect(groundingLabel(0.35)).toBe('Reasoned');
    expect(groundingLabel(0.64)).toBe('Reasoned');
  });

  it('returns "Asserted" for values < 0.35', () => {
    expect(groundingLabel(0.0)).toBe('Asserted');
    expect(groundingLabel(0.34)).toBe('Asserted');
  });

  it('returns empty string for undefined', () => {
    expect(groundingLabel(undefined)).toBe('');
  });
});

// ── countOccurrences ─────────────────────────────────────────

describe('countOccurrences', () => {
  it('counts a single occurrence', () => {
    expect(countOccurrences('hello world', 'world')).toBe(1);
  });

  it('counts multiple occurrences', () => {
    expect(countOccurrences('the cat and the cat', 'cat')).toBe(2);
  });

  it('is case insensitive', () => {
    expect(countOccurrences('Hello HELLO hello', 'hello')).toBe(3);
  });

  it('returns 0 for empty query string', () => {
    expect(countOccurrences('some text', '')).toBe(0);
  });

  it('returns 0 when query is not found', () => {
    expect(countOccurrences('hello world', 'xyz')).toBe(0);
  });

  it('handles overlapping matches correctly (non-overlapping count)', () => {
    // 'aa' in 'aaaa' has 2 non-overlapping matches
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
  });
});

// ── stripLeadingHeadings ─────────────────────────────────────

describe('stripLeadingHeadings', () => {
  it('removes a single # heading at the start', () => {
    const input = '# My Heading\nContent here';
    expect(stripLeadingHeadings(input)).toBe('Content here');
  });

  it('removes ## and ### headings at the start', () => {
    expect(stripLeadingHeadings('## Sub-heading\nContent')).toBe('Content');
    expect(stripLeadingHeadings('### Sub-sub-heading\nContent')).toBe('Content');
  });

  it('removes multiple consecutive leading headings', () => {
    const input = '# Title\n## Subtitle\nContent here';
    expect(stripLeadingHeadings(input)).toBe('Content here');
  });

  it('preserves content that does not start with a heading', () => {
    const input = 'Normal paragraph here';
    expect(stripLeadingHeadings(input)).toBe('Normal paragraph here');
  });

  it('preserves headings that appear after non-heading content', () => {
    const input = 'First paragraph\n# Heading later';
    expect(stripLeadingHeadings(input)).toBe('First paragraph\n# Heading later');
  });

  it('returns empty string when text is only headings', () => {
    expect(stripLeadingHeadings('# Heading\n')).toBe('');
  });
});

// ── fixMarkdownLinks ─────────────────────────────────────────

describe('fixMarkdownLinks', () => {
  it('collapses whitespace/newlines within a link URL', () => {
    const input = '[Some text](https://example.com/\nlong/path)';
    const result = fixMarkdownLinks(input);
    expect(result).toBe('[Some text](https://example.com/long/path)');
  });

  it('leaves a clean link unchanged', () => {
    const input = '[Clean link](https://example.com/page)';
    expect(fixMarkdownLinks(input)).toBe(input);
  });

  it('repairs a DOI link by extracting the DOI from the link text', () => {
    const input = '[Some paper (doi: 10.1234/abc123)](https://broken.url)';
    const result = fixMarkdownLinks(input);
    expect(result).toContain('https://doi.org/10.1234/abc123');
  });

  it('cleans DOI parenthetical from link display text', () => {
    const input = '[AI Safety Paper (doi: 10.1234/abc)](https://broken.url)';
    const result = fixMarkdownLinks(input);
    // Display text should have the doi parenthetical stripped
    expect(result).toMatch(/^\[AI Safety Paper\]/);
  });

  it('handles multiple links in text', () => {
    const input = '[A](https://a.com) and [B](https://b.com/\npath)';
    const result = fixMarkdownLinks(input);
    expect(result).toBe('[A](https://a.com) and [B](https://b.com/path)');
  });
});

// ── nodeIdToTab ──────────────────────────────────────────────

describe('nodeIdToTab', () => {
  it('maps acc- prefix to accelerationist tab', () => {
    expect(nodeIdToTab('acc-beliefs-001').tab).toBe('accelerationist');
  });

  it('maps saf- prefix to safetyist tab', () => {
    expect(nodeIdToTab('saf-desires-001').tab).toBe('safetyist');
  });

  it('maps skp- prefix to skeptic tab', () => {
    expect(nodeIdToTab('skp-intentions-001').tab).toBe('skeptic');
  });

  it('maps sit- prefix to situations tab', () => {
    expect(nodeIdToTab('sit-001').tab).toBe('situations');
  });

  it('defaults unrecognized prefix to situations tab', () => {
    // nodePovFromId returns null for unknown → falls to default
    expect(nodeIdToTab('unknown-001').tab).toBe('situations');
  });

  it('includes a colorVar for known POV nodes', () => {
    const { colorVar } = nodeIdToTab('acc-beliefs-001');
    expect(colorVar).toBeTruthy();
    expect(colorVar).not.toBe('var(--text-muted)');
  });

  it('uses muted color for unrecognized nodes', () => {
    const { colorVar } = nodeIdToTab('unknown-001');
    expect(colorVar).toBe('var(--text-muted)');
  });
});
