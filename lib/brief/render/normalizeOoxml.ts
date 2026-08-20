// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// T4 Render — canonical-order normalization of ppt/presentation.xml (t/2871).
//
// pptxgenjs 3.12.0 emits <p:sldIdLst> BEFORE <p:notesMasterIdLst> whenever the deck
// has speaker notes (every real deck does — assemble.ts attaches speakerNotes). That
// violates the ECMA-376 CT_Presentation sequence, which the T5 verify OOXML lint
// (verify.ts CANONICAL_PRESENTATION_ORDER) correctly rejects — so EVERY export with
// notes hard-failed the gate (CLI and the T6 server, which share runBriefPipeline →
// render → verify). This post-process reorders the id-list/size children of
// <p:presentation> into canonical order.
//
// Pure JSZip/OOXML text surgery — mirrors potxHonor.ts. No new dep, no pptxgenjs
// surface change, and NO image decoding (t/2866: keeps pptxgenjs's transitive
// image-size parsers unreachable). Runs as the FINAL render step so it also
// normalizes any reordering introduced by the optional .potx master merge.

import JSZip from 'jszip';

// MUST match verify.ts CANONICAL_PRESENTATION_ORDER — the exact tags/order the lint checks.
const CANONICAL_PRESENTATION_ORDER = [
  'sldMasterIdLst', 'notesMasterIdLst', 'handoutMasterIdLst',
  'sldIdLst', 'sldSz', 'notesSz',
] as const;

/** Match one <p:TAG …/> (self-closing) or <p:TAG …>…</p:TAG> (container) element. */
function elementRegex(tag: string): RegExp {
  return new RegExp(`<p:${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</p:${tag}>)`);
}

interface FoundElement { tag: string; text: string; index: number }

/**
 * Reorder the canonical id-list/size children of <p:presentation> into ECMA-376
 * order. Returns the XML unchanged (===) when already canonical or when fewer than
 * two canonical children are present, so callers can skip a needless re-zip.
 */
export function reorderPresentationChildren(xml: string): string {
  const present: FoundElement[] = [];
  for (const tag of CANONICAL_PRESENTATION_ORDER) {
    const m = elementRegex(tag).exec(xml);
    if (m) present.push({ tag, text: m[0], index: m.index });
  }
  if (present.length < 2) return xml;

  const canonical = present.slice().sort(
    (a, b) => CANONICAL_PRESENTATION_ORDER.indexOf(a.tag as typeof CANONICAL_PRESENTATION_ORDER[number])
            - CANONICAL_PRESENTATION_ORDER.indexOf(b.tag as typeof CANONICAL_PRESENTATION_ORDER[number]),
  );
  // Already canonical iff document order (by index) already equals canonical order.
  const alreadyCanonical = canonical.every((el, i) => i === 0 || el.index > canonical[i - 1].index);
  if (alreadyCanonical) return xml;

  // Strip every canonical element from its current position, then reinsert the whole
  // block — in canonical order — immediately after the <p:presentation …> open tag.
  // Per CT_Presentation these id-lists/sizes are the first children, so this is the
  // correct anchor and cannot displace legitimately-earlier content (there is none).
  let stripped = xml;
  for (const el of present) stripped = stripped.replace(el.text, '');

  const open = /<p:presentation\b[^>]*>/.exec(stripped);
  if (!open) return xml; // unexpected shape — leave untouched rather than corrupt
  const at = open.index + open[0].length;
  const block = canonical.map(el => el.text).join('');
  return stripped.slice(0, at) + block + stripped.slice(at);
}

/**
 * Rewrite ppt/presentation.xml inside a .pptx zip so its <p:presentation> children
 * are in ECMA-376 canonical order. Returns the input bytes unchanged when no
 * reordering is needed (no re-zip).
 */
export async function normalizePresentationOrder(pptxBytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(pptxBytes);
  const presName = Object.keys(zip.files).find(n => /(^|\/)presentation\.xml$/.test(n) && n.includes('ppt/'));
  if (!presName) return pptxBytes;

  const xml = await zip.files[presName].async('string');
  const reordered = reorderPresentationChildren(xml);
  if (reordered === xml) return pptxBytes;

  zip.file(presName, reordered);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
