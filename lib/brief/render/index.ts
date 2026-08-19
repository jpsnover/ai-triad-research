// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — public entry (t/2802). deck_spec + narration + preset → artifacts.
// Deterministic, no model, node-pure. Produces the .pptx bytes (always) and a
// self-contained HTML doc for Electron printToPDF; the actual PDF conversion is
// Electron-only and lives in the surface layer (T7), never here.

import type { DeckSpec, Narration, BriefPreset } from '../types.js';
import type { SlideModel } from './slideModel.js';
import { assemble } from './assemble.js';
import type { SlideKind } from './slideModel.js';
import { resolveTheme } from './deckTheme.js';
import { renderPptx } from './pptxRenderer.js';
import { renderHtml } from './htmlRenderer.js';

export interface RenderInput {
  spec: DeckSpec;
  narration: Narration;
  preset: BriefPreset;
  /**
   * Optional .potx bytes. When supplied, v2 (t/2820) extracts theme colors/fonts
   * and injects the .potx slide masters into the rendered output. A
   * `template_parse_error` warning is emitted if the bytes are not a valid zip.
   */
  template?: Uint8Array;
  /**
   * When explicitly false, removes the `framing_meta` slide from classroom exports (t/2838, T7-v2).
   * Undefined / true → include it (preset default). Has no effect on policymaker/conference
   * (neither preset includes `framing_meta`).
   */
  framingMeta?: boolean;
}

export interface RenderResult {
  /** ALWAYS — the primary deliverable, the real OOXML bytes handed to T5 verify(). */
  pptxBytes: Uint8Array;
  /** Self-contained HTML for Electron printToPDF (PDF is Electron-only). */
  htmlDoc: string;
  /** The assembled slide IR — exposed for tests/debugging. */
  slideModels: SlideModel[];
  /** Non-fatal render warnings (trimmed content, template_parse_error, empty slides). */
  warnings: string[];
}

export async function render(input: RenderInput): Promise<RenderResult> {
  const { theme, warning } = await resolveTheme(input.template);
  const excludeSlides = input.framingMeta === false
    ? new Set<SlideKind>(['framing_meta'])
    : undefined;
  const { slides, warnings } = assemble(input.spec, input.narration, input.preset, excludeSlides ? { excludeSlides } : undefined);
  const allWarnings: string[] = warning ? [warning, ...warnings] : [...warnings];

  let pptxBytes = await renderPptx(slides, theme);

  if (input.template && !warning) {
    // Template was parsed successfully — inject its slide masters as a post-process.
    // Falls back to the unmerged bytes on failure (never silent: warning is appended).
    try {
      const { mergePotxMasters } = await import('./potxHonor.js');
      pptxBytes = await mergePotxMasters(pptxBytes, input.template);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      allWarnings.push(`template_masters_not_merged: slide-master injection failed — ${msg}`);
    }
  }

  const htmlDoc = renderHtml(slides, theme);

  return { pptxBytes, htmlDoc, slideModels: slides, warnings: allWarnings };
}

export type { SlideModel } from './slideModel.js';
export { HOUSE_THEME, CAMP_COLORS } from './deckTheme.js';
