// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2448 — the BDI-scales doc-link (TheoryLink) renders beside each scale label
// (Priority/Operationality via RankedSelectCell, Confidence via ConfidenceCell) and
// opens the docs/bdi-scales.md GitHub blob URL through the bridge.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RankedSelectCell, ConfidenceCell } from './GraphAttributesPanel';

const openExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('@bridge', () => ({ api: { openExternal: (...args: unknown[]) => openExternal(...args) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

const BDI_DOC_URL = 'https://github.com/jpsnover/ai-triad-research/blob/main/docs/bdi-scales.md';

describe('GraphAttributesPanel — BDI scale doc-links (t/2448)', () => {
  beforeEach(() => { openExternal.mockClear(); cleanup(); });

  it('renders the doc link beside a RankedSelectCell label and opens docs/bdi-scales.md', () => {
    render(<RankedSelectCell label="Priority" value={3} options={[{ value: 3, label: '3 — Important' }]} />);
    const link = screen.getByRole('button', { name: /how the bdi scales work/i });
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(BDI_DOC_URL);
  });

  it('renders the doc link beside the Confidence label and opens docs/bdi-scales.md', () => {
    render(<ConfidenceCell value={0.5} />);
    const link = screen.getByRole('button', { name: /how the bdi scales work/i });
    expect(link).toBeTruthy();
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(BDI_DOC_URL);
  });
});
