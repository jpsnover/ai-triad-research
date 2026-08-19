// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — the ONE bounded surface over pptxgenjs (TL build condition 1).
// Nothing else in lib/brief imports pptxgenjs; a future library swap rewrites
// only this file. Input is the target-neutral SlideModel[]; output is the real
// serialized .pptx bytes handed to T5 verify().

import PptxGenJS from 'pptxgenjs';
import type { SlideModel, SlideBlock } from './slideModel.js';
import type { DeckTheme } from './deckTheme.js';
import { campColor } from './deckTheme.js';

const MARGIN = 0.5;
const CONTENT_W = 9.0; // 10in slide width minus margins
const TITLE_Y = 0.4;
const BODY_Y = 1.4;

export async function renderPptx(slides: SlideModel[], theme: DeckTheme): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'BRIEF', width: 10, height: 7.5 });
  pptx.layout = 'BRIEF';
  pptx.theme = { headFontFace: theme.fonts.heading, bodyFontFace: theme.fonts.body };

  for (const model of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: theme.colors.background };

    slide.addText(model.title, {
      x: MARGIN, y: TITLE_Y, w: CONTENT_W, h: 0.8,
      fontSize: 28, bold: true, color: theme.colors.text, fontFace: theme.fonts.heading,
    });

    layoutBlocks(slide, model.blocks, theme);

    if (model.watermark) {
      slide.addText(model.watermark, {
        x: MARGIN, y: 3.2, w: CONTENT_W, h: 1.0,
        fontSize: 54, bold: true, color: theme.colors.verdict.Disputed,
        align: 'center', rotate: 315, transparency: 80,
      });
    }

    if (model.speakerNotes.length > 0) {
      const notes = model.speakerNotes.map(n => `[${n.trace}] ${n.text}`).join('\n');
      slide.addNotes(notes);
    }
  }

  // pptxgenjs emits valid OOXML (positive offsets, canonical p:presentation order),
  // so the render output passes T5's OOXML lint by construction.
  const out = await pptx.write({ outputType: 'uint8array' });
  return out as Uint8Array;
}

function layoutBlocks(slide: PptxGenJS.Slide, blocks: SlideBlock[], theme: DeckTheme): void {
  let y = BODY_Y;
  for (const block of blocks) {
    y = layoutBlock(slide, block, theme, y);
    y += 0.2;
  }
}

function layoutBlock(slide: PptxGenJS.Slide, block: SlideBlock, theme: DeckTheme, y: number): number {
  switch (block.type) {
    case 'text':
      slide.addText(block.text, {
        x: MARGIN, y, w: CONTENT_W, h: 0.8, fontSize: 18, color: theme.colors.text, fontFace: theme.fonts.body,
      });
      return y + 0.8;

    case 'note':
      slide.addText(block.text, {
        x: MARGIN, y, w: CONTENT_W, h: 0.5, fontSize: 12, italic: true, color: theme.colors.subtle, fontFace: theme.fonts.body,
      });
      return y + 0.5;

    case 'bullets':
      slide.addText(block.items.map(t => ({ text: t, options: { bullet: true } })), {
        x: MARGIN, y, w: CONTENT_W, h: Math.min(4, 0.4 * block.items.length + 0.3),
        fontSize: 16, color: theme.colors.text, fontFace: theme.fonts.body,
      });
      return y + Math.min(4, 0.4 * block.items.length + 0.3);

    case 'card_row': {
      const n = Math.max(1, block.cards.length);
      const gap = 0.3;
      const cardW = (CONTENT_W - gap * (n - 1)) / n;
      block.cards.forEach((card, i) => {
        const cx = MARGIN + i * (cardW + gap);
        slide.addText(
          [
            { text: card.title, options: { bold: true, fontSize: 16, color: campColor(card.camp) } },
            ...card.lines.map(l => ({ text: l, options: { bullet: true, fontSize: 13, color: theme.colors.text } })),
          ],
          { x: cx, y, w: cardW, h: 3.0, valign: 'top', fontFace: theme.fonts.body,
            line: { color: campColor(card.camp), width: 1 }, margin: 6 },
        );
      });
      return y + 3.0;
    }

    case 'fork':
      slide.addText(
        [
          { text: block.prompt, options: { bold: true, fontSize: 16, color: theme.colors.text } },
          { text: `If yes → ${block.ifYes}`, options: { bullet: true, fontSize: 13, color: theme.colors.text } },
          { text: `If no → ${block.ifNo}`, options: { bullet: true, fontSize: 13, color: theme.colors.text } },
        ],
        { x: MARGIN, y, w: CONTENT_W, h: 1.4, valign: 'top', fontFace: theme.fonts.body },
      );
      return y + 1.5;

    case 'badge_row': {
      const text = block.badges.map(b => `${b.label}: ${b.value}`).join('    ');
      slide.addText(text, { x: MARGIN, y, w: CONTENT_W, h: 0.6, fontSize: 15, color: theme.colors.accent, fontFace: theme.fonts.body });
      return y + 0.6;
    }

    case 'table': {
      const header = block.headers.map(h => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: theme.colors.accent } } }));
      const rows = block.rows.map(r => r.map(cell => ({ text: cell, options: { color: theme.colors.text } })));
      slide.addTable([header, ...rows], {
        x: MARGIN, y, w: CONTENT_W, fontSize: 13, border: { type: 'solid', color: theme.colors.subtle, pt: 1 }, fontFace: theme.fonts.body,
      });
      return y + 0.4 * (rows.length + 1) + 0.2;
    }
  }
}
