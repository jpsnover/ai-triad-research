// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1716 — FactCheckCard renders the new `partially_accurate` verdict with distinct
// styling (not folded into supported/pass) and surfaces the evidence-gated
// discrepancy (claimed → actual, dimension, severity), with `major` severity reading
// as a caveat rather than a pass.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { FactCheckCard } from './StatementCard';
import type { TranscriptEntry } from '@lib/debate/types';
import type { FactDiscrepancy } from '@lib/debate/types';

vi.mock('react-markdown', () => ({ default: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('remark-gfm', () => ({ default: {} }));
vi.mock('./utils', () => ({
  speakerLabel: (s: string) => s, speakerColor: () => '#999', pctFmt: (v: number) => `${v}`,
  focusMainWindowNode: vi.fn(), fixMarkdownLinks: (s: string) => s, stripLeadingHeadings: (s: string) => s,
}));
vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: Object.assign((sel: any) => sel({ activeDebate: null }), { getState: () => ({ activeDebate: null, setSelectedRef: vi.fn() }) }),
}));
vi.mock('../../utils/lineageMatcher', () => ({ lineageMarkdownComponents: {}, extractLineageNames: () => [] }));
vi.mock('./TaxonomyRefs', () => ({ TaxonomyRefsSection: () => <div /> }));

afterEach(() => vi.clearAllMocks());

function factCheckEntry(fc: Record<string, unknown>): TranscriptEntry {
  return {
    id: 'fc1', timestamp: '2026-01-01T00:00:00Z', type: 'fact-check', speaker: 'system',
    content: 'Fact Check body', taxonomy_refs: [], metadata: { fact_check: fc },
  };
}

const discrepancy: FactDiscrepancy = {
  dimension: 'magnitude', claimed: '12 states', actual: '10 states', source: 'sit-001', severity: 'minor',
};

describe('FactCheckCard — partially_accurate verdict + discrepancy (t/1716)', () => {
  it('renders partially_accurate with its own verdict class + human label (not folded into supported)', () => {
    const { container } = render(<FactCheckCard entry={factCheckEntry({ verdict: 'partially_accurate', discrepancy, explanation: '', checked_text: 'x' })} />);
    const verdict = container.querySelector('.debate-fact-check-verdict');
    expect(verdict?.textContent?.trim()).toBe('Partially Accurate');
    expect(verdict?.classList.contains('debate-fact-check-partially_accurate')).toBe(true);
    expect(verdict?.classList.contains('debate-fact-check-supported')).toBe(false);
    // Card border variant too.
    expect(container.querySelector('.debate-type-fact-check.debate-fact-check-partially_accurate')).toBeTruthy();
  });

  it('surfaces the discrepancy: claimed → actual, dimension, and minor severity', () => {
    const { container } = render(<FactCheckCard entry={factCheckEntry({ verdict: 'partially_accurate', discrepancy, explanation: '', checked_text: 'x' })} />);
    const block = container.querySelector('.debate-fact-check-discrepancy');
    expect(block).toBeTruthy();
    expect(block?.querySelector('.debate-fact-check-discrepancy-claimed')?.textContent).toBe('12 states');
    expect(block?.querySelector('.debate-fact-check-discrepancy-actual')?.textContent).toBe('10 states');
    expect(block?.querySelector('.debate-fact-check-discrepancy-dimension')?.textContent).toBe('Magnitude');
    expect(block?.textContent).toContain('Minor');
    expect(block?.classList.contains('debate-fact-check-severity-minor')).toBe(true);
  });

  it('major severity is visually distinct and reads as a caveat, not a pass (AC#3)', () => {
    const major: FactDiscrepancy = { ...discrepancy, severity: 'major' };
    const { container } = render(<FactCheckCard entry={factCheckEntry({ verdict: 'partially_accurate', discrepancy: major, explanation: '', checked_text: 'x' })} />);
    const block = container.querySelector('.debate-fact-check-discrepancy');
    expect(block?.classList.contains('debate-fact-check-severity-major')).toBe(true);
    expect(block?.textContent).toContain('Major');
    expect(block?.querySelector('.debate-fact-check-discrepancy-severity')?.textContent).toContain('⚠');
  });

  it('does not render a discrepancy block for a plain supported verdict', () => {
    const { container } = render(<FactCheckCard entry={factCheckEntry({ verdict: 'supported', explanation: '', checked_text: 'x' })} />);
    expect(container.querySelector('.debate-fact-check-discrepancy')).toBeNull();
    expect(container.querySelector('.debate-fact-check-verdict')?.textContent?.trim()).toBe('Supported');
  });
});
