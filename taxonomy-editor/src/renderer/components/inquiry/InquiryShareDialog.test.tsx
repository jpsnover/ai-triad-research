// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tests for the mint-time disclosure preview (t/3654). The load-bearing assertion is TL's
// drift guard (t/3654#1): the preview must render from the SAME projector output the public
// page (PublicInquiryView) would render for the same InquiryResult — proven here by asserting
// the dialog's rendered text matches PublicInquiryShareContent fed toPublicInquiryShare(result)
// directly, not a separately-assembled preview.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toPublicInquiryShare } from '@lib/inquiry';
import type { InquiryResult } from '../../bridge/types';
import { InquiryShareDialog } from './InquiryShareDialog';
import { PublicInquiryShareContent } from '../PublicInquiryShareContent';

const SAMPLE_RESULT = {
  schemaVersion: 1,
  request: { question: 'What counts as an AI harm? (mentions Jane Doe)', fidelity: 'standard' },
  campVerdicts: [
    { camp: 'acc', verdict: 'Harm requires realized, measurable damage.', nodes: [{ nodeId: 'acc-1', label: 'Move fast', camp: 'acc' }] },
  ],
  convergences: [],
  evidenceLayers: [],
  unresolvedGaps: [],
  calibration: [
    { metric: 'engagement', value: 0.8, trust: { verdict: 'trust', reason: 'Both camps directly rebutted the crux.' } },
  ],
  derivation: { fidelity: 'standard', models: { debaters: 'claude-sonnet-5', evaluator: 'claude-opus-5' }, rounds: 4, callBudget: 150 },
  grounding: { nodesByCamp: {} },
  singleRunCaveat: 'This is one run of a stochastic process, not a repeated-measures finding.',
} as unknown as InquiryResult;

describe('InquiryShareDialog (t/3654)', () => {
  it('renders the question text prominently, unredacted, for the sharer to review', () => {
    render(<InquiryShareDialog result={SAMPLE_RESULT} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(SAMPLE_RESULT.request.question)).toBeInTheDocument();
  });

  it('renders TrustState.reason and provenance, matching PublicInquiryView\'s must-includes', () => {
    render(<InquiryShareDialog result={SAMPLE_RESULT} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Both camps directly rebutted the crux.')).toBeInTheDocument();
    expect(screen.getByText('claude-sonnet-5')).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_RESULT.singleRunCaveat)).toBeInTheDocument();
  });

  // The drift guard: derive the same doc independently (as PublicInquiryView would) and diff
  // the two renders' text content. Any hand-built/independently-assembled preview would drift
  // from this the moment a field is added to the projector without a matching preview update —
  // this test fails on that class of bug, not just on the current fixture's content.
  it('renders identically to PublicInquiryShareContent fed the same projector output (drift guard)', () => {
    const doc = toPublicInquiryShare(SAMPLE_RESULT);
    const { container: dialogContainer } = render(
      <InquiryShareDialog result={SAMPLE_RESULT} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const { container: directContainer } = render(<PublicInquiryShareContent doc={doc} />);
    expect(dialogContainer.querySelector('.pov-inquiry-card')?.textContent).toBe(
      directContainer.querySelector('.pov-inquiry-card')?.textContent,
    );
  });

  it('calls onConfirm / onCancel from the dialog actions, not from clicking inside the preview', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<InquiryShareDialog result={SAMPLE_RESULT} onConfirm={onConfirm} onCancel={onCancel} />);

    screen.getByText('Create public link').click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    screen.getByText('Cancel').click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
