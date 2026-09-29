// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Adjacency test (t/3734, SO condition via t/3667#6) for the shared public-surface renderer.
// This component backs BOTH PublicInquiryView.tsx (the live /inquiries/:shareId page) and
// InquiryShareDialog.tsx's mint-time preview (t/3654) — one structural fix here covers both.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicInquiryShare } from '@lib/inquiry';
import { PublicInquiryShareContent } from './PublicInquiryShareContent';

const BASE_DOC = {
  version: 1 as const,
  request: { question: 'What counts as an AI harm?', fidelity: 'standard' as const },
  campVerdicts: [],
  convergences: [],
  evidenceLayers: [],
  unresolvedGaps: [],
  calibration: [],
  derivation: { fidelity: 'standard' as const, models: { debaters: 'claude-sonnet-5', evaluator: 'claude-opus-5' }, rounds: 4 },
  grounding: { nodesByCamp: {} },
  singleRunCaveat: 'This is one run of a stochastic process, not a repeated-measures finding.',
} as unknown as PublicInquiryShare;

describe('PublicInquiryShareContent headline/caveat adjacency (t/3734)', () => {
  it('renders synthesizedHeadline immediately adjacent to singleRunCaveat, inside one wrapper', () => {
    const doc = { ...BASE_DOC, synthesizedHeadline: 'Camps converge on outcome, diverge on intent.' } as PublicInquiryShare;
    render(<PublicInquiryShareContent doc={doc} />);

    const headline = screen.getByText('Camps converge on outcome, diverge on intent.');
    const caveat = screen.getByText(BASE_DOC.singleRunCaveat, { exact: false });

    expect(headline.parentElement).toBe(caveat.parentElement);
    expect(caveat.previousElementSibling).toBe(headline);
  });

  it('suppresses the headline slot when synthesizedHeadline is absent (Condition A: absent by construction), caveat still renders', () => {
    render(<PublicInquiryShareContent doc={BASE_DOC} />);

    const caveat = screen.getByText(BASE_DOC.singleRunCaveat, { exact: false });
    expect(caveat.previousElementSibling).toBeNull();
  });
});
