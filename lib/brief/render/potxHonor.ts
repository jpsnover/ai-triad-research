// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — .potx theme extraction and slide-master merge (t/2820).
// Two exports:
//   extractPotxTheme  — parse theme colors/fonts from .potx bytes → DeckTheme
//   mergePotxMasters  — post-process: inject .potx slide masters into pptxgenjs output
//
// No new deps: JSZip is already in lib/package.json (used by verify.ts).
// This is intentionally the ONLY place that reads .potx bytes; pptxRenderer.ts
// stays the only pptxgenjs surface (TL build condition 1 preserved).
//
// SECURITY (t/2866): this is the ONLY reader of user-supplied .potx bytes, and it does so
// via pure JSZip/OOXML text surgery — it never decodes embedded images. That keeps
// pptxgenjs's transitive `image-size` (CVE-2025-71329 / CVE-2025-71330 — ICNS/JXL/HEIF DoS,
// no patched release) unreachable, the basis for the Dependabot dismissal. Do NOT add
// image-byte parsing of .potx content here without re-triaging t/2866.

import JSZip from 'jszip';
import type { DeckTheme } from './deckTheme.js';
import { HOUSE_THEME } from './deckTheme.js';

// ── Theme extraction ─────────────────────────────────────────────────────────

function parseColorBlock(themeXml: string, role: string): string | undefined {
  const block = themeXml.match(new RegExp(`<a:${role}>[\\s\\S]*?</a:${role}>`));
  if (!block) return undefined;
  // srgbClr val="RRGGBB" (most themes)
  const srgb = block[0].match(/val="([0-9A-Fa-f]{6})"/);
  if (srgb) return srgb[1].toUpperCase();
  // sysClr lastClr="RRGGBB" (system-color themes)
  const sys = block[0].match(/lastClr="([0-9A-Fa-f]{6})"/);
  return sys ? sys[1].toUpperCase() : undefined;
}

function parseFontFace(themeXml: string, which: 'majorFont' | 'minorFont'): string | undefined {
  const block = themeXml.match(new RegExp(`<a:${which}>[\\s\\S]*?</a:${which}>`));
  if (!block) return undefined;
  const m = block[0].match(/<a:latin typeface="([^"]+)"/);
  return m ? m[1] : undefined;
}

/**
 * Parse a DeckTheme from .potx bytes by reading ppt/theme/theme1.xml.
 * Falls back to HOUSE_THEME for any color/font not found in the template.
 * Verdict colors are always kept from HOUSE_THEME — no .potx equivalent exists
 * for the Supported/Disputed/Unverifiable semantic roles.
 */
export async function extractPotxTheme(potxBytes: Uint8Array): Promise<DeckTheme> {
  const zip = await JSZip.loadAsync(potxBytes);
  const themeFile = zip.file('ppt/theme/theme1.xml');
  if (!themeFile) return HOUSE_THEME;

  const xml = await themeFile.async('string');
  return {
    name: 'Template',
    colors: {
      background: parseColorBlock(xml, 'lt1')     ?? HOUSE_THEME.colors.background,
      text:       parseColorBlock(xml, 'dk1')     ?? HOUSE_THEME.colors.text,
      subtle:     parseColorBlock(xml, 'dk2')     ?? HOUSE_THEME.colors.subtle,
      accent:     parseColorBlock(xml, 'accent1') ?? HOUSE_THEME.colors.accent,
      verdict: HOUSE_THEME.colors.verdict,
    },
    fonts: {
      heading: parseFontFace(xml, 'majorFont') ?? HOUSE_THEME.fonts.heading,
      body:    parseFontFace(xml, 'minorFont') ?? HOUSE_THEME.fonts.body,
    },
  };
}

// ── Slide master merge ───────────────────────────────────────────────────────

const MASTER_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';

/**
 * rId base for injected masters. pptxgenjs emits rId1 (sole master) then rId2,
 * rId3, … for slides. Starting injected master rIds at 100 avoids any collision
 * with those generated IDs without requiring a full renumber of the rels.
 */
const MASTER_RID_BASE = 100;

const TEMPLATE_PREFIXES = ['ppt/slideMasters/', 'ppt/slideLayouts/', 'ppt/theme/'];

function countFiles(zip: JSZip, pattern: RegExp): number {
  let n = 0;
  zip.forEach(path => { if (pattern.test(path)) n++; });
  return n;
}

/** Collect ppt/media/* paths referenced from template master/layout _rels. */
async function collectTemplateMedia(potxZip: JSZip): Promise<string[]> {
  const media = new Set<string>();
  const relPrefixes = ['ppt/slideMasters/_rels/', 'ppt/slideLayouts/_rels/'];
  for (const prefix of relPrefixes) {
    const relFiles: string[] = [];
    potxZip.forEach(path => {
      if (path.startsWith(prefix) && path.endsWith('.rels')) relFiles.push(path);
    });
    for (const rf of relFiles) {
      const xml = await potxZip.file(rf)!.async('string');
      for (const m of xml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)) {
        media.add(`ppt/media/${m[1]}`);
      }
    }
  }
  return [...media];
}

/** Replace slideMaster relationships in ppt/_rels/presentation.xml.rels. */
async function injectMasterRels(pptxZip: JSZip, masterCount: number): Promise<void> {
  const relsFile = pptxZip.file('ppt/_rels/presentation.xml.rels');
  let xml = relsFile ? await relsFile.async('string') : '';

  // Remove existing slideMaster entries (pptxgenjs always emits exactly one)
  xml = xml.replace(/<Relationship\s[^>]*Type="[^"]*\/slideMaster"[^>]*\/>/g, '');

  const newRels = Array.from({ length: masterCount }, (_, i) =>
    `  <Relationship Id="rId${MASTER_RID_BASE + i}" Type="${MASTER_TYPE}" Target="slideMasters/slideMaster${i + 1}.xml"/>`,
  ).join('\n');

  xml = xml.replace('</Relationships>', `${newRels}\n</Relationships>`);
  pptxZip.file('ppt/_rels/presentation.xml.rels', xml);
}

/** Rewrite <p:sldMasterIdLst> in ppt/presentation.xml to reference injected masters. */
async function updateSldMasterIdLst(pptxZip: JSZip, masterCount: number): Promise<void> {
  const presFile = pptxZip.file('ppt/presentation.xml');
  if (!presFile) return;
  let xml = await presFile.async('string');

  const entries = Array.from({ length: masterCount }, (_, i) =>
    `<p:sldMasterId id="${2147483648 + i}" r:id="rId${MASTER_RID_BASE + i}"/>`,
  ).join('');

  xml = xml.replace(
    /<p:sldMasterIdLst>[\s\S]*?<\/p:sldMasterIdLst>/,
    `<p:sldMasterIdLst>${entries}</p:sldMasterIdLst>`,
  );
  pptxZip.file('ppt/presentation.xml', xml);
}

/** Swap Override entries for template-managed parts in [Content_Types].xml. */
async function updateContentTypes(pptxZip: JSZip, potxZip: JSZip): Promise<void> {
  const ctFile = pptxZip.file('[Content_Types].xml');
  if (!ctFile) return;
  let xml = await ctFile.async('string');

  // Remove existing overrides for parts we are replacing
  xml = xml.replace(
    /<Override PartName="\/ppt\/(slideMasters|slideLayouts|theme)\/[^"]*"[^/]*\/>/g,
    '',
  );

  const potxCt = potxZip.file('[Content_Types].xml');
  if (potxCt) {
    const potxXml = await potxCt.async('string');
    const overrides = [
      ...potxXml.matchAll(
        /<Override PartName="\/ppt\/(slideMasters|slideLayouts|theme)\/[^"]*"[^/]*\/>/g,
      ),
    ].map(m => m[0]).join('\n');

    xml = xml.replace('</Types>', `${overrides}\n</Types>`);
  }

  pptxZip.file('[Content_Types].xml', xml);
}

/**
 * Post-process a pptxgenjs-generated .pptx to inject slide masters and layouts
 * from the supplied .potx template. Slide content is unchanged; only the
 * master/layout/theme parts are replaced so the org's branded master layouts
 * are preserved in the rendered brief.
 *
 * The T4→T5 byte contract is maintained: verify() receives valid OOXML bytes
 * and its lint checks (negative-offset scan, canonical presentation.xml order)
 * still apply to the final shipped content.
 */
export async function mergePotxMasters(
  pptxBytes: Uint8Array,
  potxBytes: Uint8Array,
): Promise<Uint8Array> {
  const [pptxZip, potxZip] = await Promise.all([
    JSZip.loadAsync(pptxBytes),
    JSZip.loadAsync(potxBytes),
  ]);

  // Remove template-managed parts from the generated output
  const toRemove: string[] = [];
  pptxZip.forEach(path => {
    if (TEMPLATE_PREFIXES.some(p => path.startsWith(p))) toRemove.push(path);
  });
  toRemove.forEach(p => pptxZip.remove(p));

  // Copy all template parts (masters, layouts, theme, their _rels) from .potx
  const potxFilePaths: string[] = [];
  potxZip.forEach((path, file) => {
    if (!file.dir && TEMPLATE_PREFIXES.some(p => path.startsWith(p))) {
      potxFilePaths.push(path);
    }
  });
  for (const path of potxFilePaths) {
    pptxZip.file(path, await potxZip.file(path)!.async('uint8array'));
  }

  // Copy media assets referenced by the template's masters/layouts
  for (const mediaPath of await collectTemplateMedia(potxZip)) {
    const f = potxZip.file(mediaPath);
    if (f) pptxZip.file(mediaPath, await f.async('uint8array'));
  }

  const masterCount = countFiles(
    potxZip,
    /^ppt\/slideMasters\/slideMaster\d+\.xml$/,
  );

  await injectMasterRels(pptxZip, masterCount);
  await updateSldMasterIdLst(pptxZip, masterCount);
  await updateContentTypes(pptxZip, potxZip);

  return pptxZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
