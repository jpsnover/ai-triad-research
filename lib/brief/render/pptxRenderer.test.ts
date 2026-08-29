// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Render-path guard for the bounded pptxgenjs surface (pptxRenderer.ts). The rest of the brief
// suite fabricates/mocks the .pptx bytes (JSZip, `new Uint8Array([1,2,3])`), so nothing exercised
// the REAL pptxgenjs render — which is exactly where a pptxgenjs version bump can regress silently
// (surfaced during the 3→4 major review, DevOps p/27#29). This drives renderPptx through the full
// bounded surface (constructor interop + defineLayout + layout/theme/background setters + addText
// [string, runs, bullets] + addTable + addNotes + write) and asserts a valid OOXML package comes
// out — so a future bump that breaks the constructor cast or any used API fails HERE, in CI.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderPptx } from './pptxRenderer.js';
import { HOUSE_THEME } from './deckTheme.js';
import type { SlideModel } from './slideModel.js';

// One slide exercising every SlideBlock kind + speaker notes + watermark → touches every method
// the renderer calls on pptxgenjs. Kept minimal but total-coverage of the bounded surface.
const DECK: SlideModel[] = [{
  kind: 'title',
  title: 'Render Guard Deck',
  blocks: [
    { type: 'text', text: 'A paragraph of body copy.' },
    { type: 'bullets', items: ['first', 'second', 'third'] },
    { type: 'card_row', cards: [
      { camp: 'acc', title: 'Accelerationist', lines: ['point a', 'point b'] },
      { camp: 'saf', title: 'Safetyist', lines: ['point c'] },
    ] },
    { type: 'fork', prompt: 'Decision?', ifYes: 'do X', ifNo: 'do Y' },
    { type: 'badge_row', badges: [{ label: 'Status', value: 'Draft' }] },
    { type: 'table', headers: ['Col 1', 'Col 2'], rows: [['a', 'b'], ['c', 'd']] },
    { type: 'note', text: 'An editorial note.' },
  ],
  speakerNotes: [{ text: 'Speaker note text', trace: '/slides/0' }],
  watermark: 'IN PROGRESS',
}];

describe('renderPptx — real pptxgenjs render guard (bounded surface)', () => {
  it('renders the full block grammar into a valid .pptx OOXML package', async () => {
    const bytes = await renderPptx(DECK, HOUSE_THEME);

    // Real serialized output, not a stub.
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);

    // Valid OOXML zip with the parts a one-slide, notes-bearing deck must contain.
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('ppt/presentation.xml')).toBeTruthy();
    expect(zip.file('ppt/slides/slide1.xml')).toBeTruthy();
    // addNotes(...) must have produced a notes part (guards the speaker-notes path).
    expect(zip.file('ppt/notesSlides/notesSlide1.xml')).toBeTruthy();
  });

  it('renders an empty deck without throwing (constructor + write path, no slides)', async () => {
    const bytes = await renderPptx([], HOUSE_THEME);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('ppt/presentation.xml')).toBeTruthy();
  });
});
