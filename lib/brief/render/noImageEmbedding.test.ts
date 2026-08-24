// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2866 prevention gate. The Dependabot dismissal of image-size CVE-2025-71329 /
// CVE-2025-71330 (ICNS/JXL/HEIF parser DoS, no patched release) rests on a single
// load-bearing invariant: NO image reaches pptxgenjs, because pptxgenjs only invokes
// its transitive `image-size` dependency when measuring an image passed to
// addImage()/addMedia(). The bounded pptxgenjs surface (pptxRenderer.ts) deliberately
// exposes none, and the user-.potx path (potxHonor.ts) is pure OOXML/zip surgery.
//
// The guard COMMENTS in those files document the invariant; this test ENFORCES it, so a
// future change that adds image embedding fails CI (with a pointer to re-triage) instead
// of silently making the vulnerable parsers reachable. Detector matches the call form
// `.addImage(` / `.addMedia(` — not the bare words in the guard comments.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER_DIR = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_EMBED_CALL = /\.(addImage|addMedia)\s*\(/;

describe('brief render layer stays free of pptxgenjs image embedding (t/2866)', () => {
  it('no .addImage()/.addMedia() call anywhere in lib/brief/render/*.ts', () => {
    const offenders: string[] = [];
    for (const file of fs.readdirSync(RENDER_DIR)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(RENDER_DIR, file), 'utf8');
      if (IMAGE_EMBED_CALL.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `pptxgenjs image embedding found in the brief render layer — this makes image-size ` +
        `(CVE-2025-71329/71330) reachable. Re-triage Dependabot #322–#325 (t/2866) before adding it. Offenders: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  // Detector sanity (both-arms in-file): matches a real call, ignores the guard-comment prose.
  it('detector matches an .addImage() call but not the bare word in a guard comment', () => {
    expect(IMAGE_EMBED_CALL.test('const s = deck.addSlide(); s.addImage(buf);')).toBe(true);
    expect(IMAGE_EMBED_CALL.test('deck.addMedia({ type: "image", data })')).toBe(true);
    expect(IMAGE_EMBED_CALL.test('// exposes NO addImage/addMedia: keeps image-size unreachable')).toBe(false);
  });
});
