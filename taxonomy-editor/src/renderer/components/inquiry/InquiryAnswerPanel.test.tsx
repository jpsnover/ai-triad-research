// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Adjacency test (t/3734, SO condition via t/3667#6): synthesizedHeadline must render adjacent
// to singleRunCaveat — structurally, not merely both-present-somewhere-on-the-page. A test that
// only checks "headline appears" would pass a layout putting the caveat three sections away,
// which is exactly the failure this ticket exists to prevent.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InquiryResult } from '../../bridge/types';

const { mockUseInquiryStore } = vi.hoisted(() => ({ mockUseInquiryStore: vi.fn() }));
vi.mock('../../hooks/useInquiryStore', () => ({ useInquiryStore: mockUseInquiryStore }));
vi.mock('../../hooks/useDebateStore', () => ({ useDebateStore: (sel: (s: { loadDebate: () => void }) => unknown) => sel({ loadDebate: vi.fn() }) }));
vi.mock('../../hooks/useTaxonomyStore', () => ({ useTaxonomyStore: (sel: (s: { setActiveTab: () => void }) => unknown) => sel({ setActiveTab: vi.fn() }) }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));
vi.mock('@bridge', () => ({ api: {}, isElectronMode: () => false }));

const { InquiryAnswerPanel } = await import('./InquiryAnswerPanel');

const BASE_RESULT = {
  request: { question: 'What counts as an AI harm?' },
  // Non-empty so isZeroResult() doesn't short-circuit into the zero-state branch, which renders
  // before the headline/caveat block entirely — this data is about avoiding that branch, not
  // about testing camp-verdict rendering.
  campVerdicts: [{ camp: 'acc', verdict: 'Harm requires realized, measurable damage.', nodes: [] }],
  convergences: [],
  evidenceLayers: [],
  unresolvedGaps: [],
  calibration: [],
  derivation: { models: { debaters: 'claude-sonnet-5', evaluator: 'claude-opus-5' }, rounds: 4, callBudget: 150 },
  grounding: { nodesByCamp: {} },
  singleRunCaveat: 'This is one run of a stochastic process, not a repeated-measures finding.',
} as unknown as InquiryResult;

function setResult(result: InquiryResult): void {
  mockUseInquiryStore.mockReturnValue({
    status: 'done', result, error: null, terminationReason: null, jobId: 'job-1', reset: vi.fn(),
  });
}

describe('InquiryAnswerPanel headline/caveat adjacency (t/3734)', () => {
  it('renders synthesizedHeadline immediately adjacent to singleRunCaveat, inside one wrapper', () => {
    setResult({ ...BASE_RESULT, synthesizedHeadline: 'Camps converge on outcome, diverge on intent.' } as InquiryResult);
    render(<InquiryAnswerPanel />);

    const headline = screen.getByText('Camps converge on outcome, diverge on intent.');
    const caveat = screen.getByText(BASE_RESULT.singleRunCaveat, { exact: false });

    // Structural, not incidental: same parent, headline is the caveat's immediately preceding sibling.
    expect(headline.parentElement).toBe(caveat.parentElement);
    expect(caveat.previousElementSibling).toBe(headline);
  });

  it('suppresses the headline slot (not an inline qualifier) when synthesizedHeadline is absent, caveat still renders', () => {
    setResult({ ...BASE_RESULT, synthesizedHeadline: undefined } as InquiryResult);
    render(<InquiryAnswerPanel />);

    const caveat = screen.getByText(BASE_RESULT.singleRunCaveat, { exact: false });
    expect(caveat.previousElementSibling).toBeNull();
  });
});
