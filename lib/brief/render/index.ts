// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — public entry (t/2802). deck_spec + narration + preset → artifacts.
// Deterministic, no model, node-pure. Produces the .pptx bytes (always) and a
// self-contained HTML doc for Electron printToPDF; the actual PDF conversion is
// Electron-only and lives in the surface layer (T7), never here.

import type { DeckSpec, Narration, BriefPreset } from '../types.js';
import type { SlideModel } from './slideModel.js';
import { assemble } from './assemble.js';
import { resolveTheme } from './deckTheme.js';
import { renderPptx } from './pptxRenderer.js';
import { renderHtml } from './htmlRenderer.js';

export interface RenderInput {
  spec: DeckSpec;
  narration: Narration;
  preset: BriefPreset;
  /** Optional .potx bytes. v1 records a disclosure warning; theming is not yet applied. */
  template?: Uint8Array;
}

export interface RenderResult {
  /** ALWAYS — the primary deliverable, the real OOXML bytes handed to T5 verify(). */
  pptxBytes: Uint8Array;
  /** Self-contained HTML for Electron printToPDF (PDF is Electron-only). */
  htmlDoc: string;
  /** The assembled slide IR — exposed for tests/debugging. */
  slideModels: SlideModel[];
  /** Non-fatal render warnings (trimmed content, template-not-honored, empty slides). */
  warnings: string[];
}

export async function render(input: RenderInput): Promise<RenderResult> {
  const { theme, warning } = resolveTheme(input.template !== undefined);
  const { slides, warnings } = assemble(input.spec, input.narration, input.preset);
  const allWarnings = warning ? [warning, ...warnings] : warnings;

  const pptxBytes = await renderPptx(slides, theme);
  const htmlDoc = renderHtml(slides, theme);

  return { pptxBytes, htmlDoc, slideModels: slides, warnings: allWarnings };
}

export type { SlideModel } from './slideModel.js';
export { HOUSE_THEME, CAMP_COLORS } from './deckTheme.js';
