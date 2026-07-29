// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Pure core for rendering stored entity-name mentions (t/1898 §4.2 / Phase 2-E).
// Mentions in `entity_mentions.json` carry an `offset` into the **NFC-canonical**
// container text and a case-preserved `quote` (see the Geometry Invariant + the
// byte-exact reconstruction recipe pinned in `lib/entities/mentionTypes.ts`). This
// module reproduces that recipe, NFC-canonicalizes once, and turns offsets into
// render segments. NO client-side NER — we consume stored records only.

import { parseEntityRef } from '@lib/entities/types';
import type { EntityRef } from '@lib/entities/types';
import type { Mention } from '@lib/entities/mentionTypes';

/** One field of a reconstructed container: its NFC-canonical text and the offset of
 *  its first character within the whole NFC container text. */
export interface ContainerField {
  name: string;
  /** NFC-canonical field text — exactly the slice of the container text mentions index into. */
  text: string;
  /** Offset of this field's first char within the NFC container text. */
  start: number;
}

export interface ReconstructedContainer {
  /** The whole NFC-canonical container text — the offset basis mentions were computed against. */
  text: string;
  /** Fields in recipe order (absent/empty omitted), each with its start offset in `text`. */
  fields: ContainerField[];
}

/** Source fields for a `node:` container (PovNode / SituationNode). */
export interface NodeContainerSource {
  label: string;
  description: string;
  plain_description?: string | null;
}

// Delimiters (mentionTypes.ts reconstruction recipe): node: fields join on a blank line
// (two LF); sei: facts join on a single LF.
const NODE_DELIM = '\n\n';
const SEI_DELIM = '\n';

/**
 * Assemble ordered non-empty parts into an NFC container, tracking each part's start.
 *
 * NFC is applied per-part and joined with the LF-based delimiter, which is byte-identical
 * to the recipe's "reconstruct then NFC the whole string last": U+000A has canonical
 * combining class 0 and no decomposition, so it is a hard normalization boundary —
 * `NFC(a + LF + b) === NFC(a) + LF + NFC(b)`. Doing it per-part yields the per-field
 * offsets for free. (Equivalence to whole-string NFC is asserted in the tests.)
 */
function assemble(parts: { name: string; raw: string }[], delim: string): ReconstructedContainer {
  const fields: ContainerField[] = [];
  let cursor = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) cursor += delim.length; // the delimiter that precedes this field
    const text = parts[i].raw.normalize('NFC');
    fields.push({ name: parts[i].name, text, start: cursor });
    cursor += text.length;
  }
  return { text: fields.map(f => f.text).join(delim), fields };
}

/** Reconstruct a `node:` container (label ⏎⏎ description ⏎⏎ plain_description; absent/empty omitted). */
export function reconstructNodeContainer(source: NodeContainerSource): ReconstructedContainer {
  const parts: { name: string; raw: string }[] = [];
  if (source.label) parts.push({ name: 'label', raw: source.label });
  if (source.description) parts.push({ name: 'description', raw: source.description });
  if (source.plain_description) parts.push({ name: 'plain_description', raw: source.plain_description });
  return assemble(parts, NODE_DELIM);
}

/** Reconstruct a `sei:` container (facts[].claim joined by single LF; empty claims omitted). */
export function reconstructSeiContainer(claims: string[]): ReconstructedContainer {
  const parts = claims
    .map((raw, i) => ({ name: `fact-${i}`, raw }))
    .filter(p => p.raw); // absent/empty omitted — no empty segment, no doubled delimiter
  return assemble(parts, SEI_DELIM);
}

/** A render segment of a field: plain text, or a linkable mention (`ref` set). */
export interface MentionSegment {
  text: string;
  ref?: EntityRef;
}

/**
 * Split ONE field's NFC text into render segments, linking the mentions that fall inside it.
 *
 * Staleness guard (render-side correctness): a mention is linked only when its `quote`
 * still matches the NFC text at its offset (`field.text.slice(local, local+len) === quote`).
 * A drifted/misplaced mention (or an unparseable ref) is dropped to plain text — never a
 * dead or mis-anchored link. Overlaps are defended against (the indexer already resolves
 * them longest-most-specific, but a later mention overlapping an accepted one is skipped).
 */
export function buildFieldSegments(field: ContainerField, mentions: Mention[]): MentionSegment[] {
  const fieldEnd = field.start + field.text.length;
  const accepted = mentions
    .filter(m => m.offset >= field.start && m.offset + m.quote.length <= fieldEnd)
    .map(m => ({ local: m.offset - field.start, quote: m.quote, ref: parseEntityRef(m.entity_ref) }))
    .filter(x => x.ref !== null && field.text.slice(x.local, x.local + x.quote.length) === x.quote)
    .sort((a, b) => a.local - b.local);

  const segs: MentionSegment[] = [];
  let cursor = 0;
  for (const x of accepted) {
    if (x.local < cursor) continue; // overlaps a prior accepted mention — skip
    if (x.local > cursor) segs.push({ text: field.text.slice(cursor, x.local) });
    const end = x.local + x.quote.length;
    segs.push({ text: field.text.slice(x.local, end), ref: x.ref! });
    cursor = end;
  }
  if (cursor < field.text.length) segs.push({ text: field.text.slice(cursor) });
  return segs;
}
