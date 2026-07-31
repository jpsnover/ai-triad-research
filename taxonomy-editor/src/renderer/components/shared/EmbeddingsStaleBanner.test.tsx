// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2064 — the coarse stale-embeddings banner renders iff the store's degradation flag
// is set, and its dismiss clears the flag. (Store-side flag logic is covered in
// useTaxonomyStore.test.ts; this locks the UI-visibility half of the AC.)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EmbeddingsStaleBanner } from './EmbeddingsStaleBanner';

const mockState: { embeddingsStale: boolean; dismissEmbeddingsStale: () => void } = {
  embeddingsStale: false,
  dismissEmbeddingsStale: vi.fn(),
};
vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

describe('EmbeddingsStaleBanner (t/2064)', () => {
  beforeEach(() => {
    cleanup();
    mockState.embeddingsStale = false;
    (mockState.dismissEmbeddingsStale as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders nothing when embeddings are not stale', () => {
    const { container } = render(<EmbeddingsStaleBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the coarse degradation notice when embeddingsStale is set', () => {
    mockState.embeddingsStale = true;
    render(<EmbeddingsStaleBanner />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/similarity results may be outdated/i)).toBeTruthy();
  });

  it('clears the flag via dismissEmbeddingsStale when dismissed', () => {
    mockState.embeddingsStale = true;
    render(<EmbeddingsStaleBanner />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(mockState.dismissEmbeddingsStale).toHaveBeenCalledTimes(1);
  });
});
