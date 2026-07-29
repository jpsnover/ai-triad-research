// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1898 — the byte-exact container reconstruction + NFC + offset segmenter are the
// correctness crux (a one-byte divergence from the indexer's recipe misplaces every
// downstream link). These tests pin the recipe from lib/entities/mentionTypes.ts and
// the render-side staleness (quote-match) guard.

import { describe, it, expect } from 'vitest';
import type { Mention } from '@lib/entities/mentionTypes';
import {
  reconstructNodeContainer,
  reconstructSeiContainer,
  buildFieldSegments,
} from './mentionText';

const m = (entity_ref: string, quote: string, offset: number): Mention =>
  ({ entity_ref, quote, offset, discovered_by: 'alias' });

describe('reconstructNodeContainer (recipe: label + LFLF + description + LFLF + plain_description)', () => {
  it('joins all three fields with a blank line (two LF), in fixed order', () => {
    const r = reconstructNodeContainer({ label: 'L', description: 'D', plain_description: 'P' });
    expect(r.text).toBe('L\n\nD\n\nP');
    expect(r.fields.map(f => [f.name, f.text, f.start])).toEqual([
      ['label', 'L', 0],
      ['description', 'D', 3],        // 1 (L) + 2 (LFLF)
      ['plain_description', 'P', 6],  // 3 + 1 (D) + 2 (LFLF)
    ]);
  });

  it('omits an absent plain_description entirely — no trailing delimiter', () => {
    const r = reconstructNodeContainer({ label: 'L', description: 'D' });
    expect(r.text).toBe('L\n\nD');
    expect(r.fields.map(f => f.name)).toEqual(['label', 'description']);
  });

  it('omits an empty middle field — no doubled/hanging delimiter', () => {
    const r = reconstructNodeContainer({ label: 'L', description: '', plain_description: 'P' });
    expect(r.text).toBe('L\n\nP');
    expect(r.fields.map(f => [f.name, f.start])).toEqual([['label', 0], ['plain_description', 3]]);
  });

  it('a single field yields no delimiter', () => {
    expect(reconstructNodeContainer({ label: 'Only', description: '' }).text).toBe('Only');
  });

  it('never whitespace-collapses the container text', () => {
    const r = reconstructNodeContainer({ label: 'a  b', description: 'c\t d' });
    expect(r.text).toBe('a  b\n\nc\t d');
  });
});

// TL-requested boundary hardening (t/1898#4): prove per-field-NFC === whole-string-NFC
// exercises the actual normalization mechanisms in BOTH directions across the LF
// boundary — not a generic denormalized blob. Each asserts the kit's output equals
// reconstruct-then-NFC-the-whole for the raw source. Combining marks via \u escapes so
// there are no literal (invisible) combining characters in the source.
describe('NFC boundary equivalence (per-field === whole-string across LF)', () => {
  const ACUTE = '́';     // combining acute accent (ccc 230)
  const DOT_BELOW = '̣'; // combining dot below (ccc 220)
  const wholeNfc = (parts: string[]) => parts.join('\n\n').normalize('NFC');

  it('(i) a field ENDING in a composable sequence composes, and does not leak across LFLF', () => {
    const label = `Cafe${ACUTE}`; // e + combining acute at the END of the field
    const description = 'x';
    const r = reconstructNodeContainer({ label, description });
    expect(r.text).toBe(wholeNfc([label, description]));
    expect(r.fields[0].text).toBe('Café'); // composed é (U+00E9), length 4 not 5
    expect(r.fields[0].text.length).toBe(4);
    expect(r.fields[1].text).toBe('x');
  });

  it('(ii) a field STARTING with a leading combining mark does not pull back across LFLF', () => {
    const label = 'base';
    const description = `${ACUTE}xyz`; // leading combining acute — must NOT compose with `base`
    const r = reconstructNodeContainer({ label, description });
    expect(r.text).toBe(wholeNfc([label, description]));
    expect(r.fields[0].text).toBe('base');                // unchanged — no cross-boundary composition
    expect(r.fields[1].text.startsWith(ACUTE)).toBe(true);
  });

  it('(iii) intra-field canonical reordering (marks out of ccc order) stays within the field', () => {
    const label = `a${ACUTE}${DOT_BELOW}`; // acute(230) before dot-below(220) → NFC reorders
    const description = 'y';
    const r = reconstructNodeContainer({ label, description });
    expect(r.text).toBe(wholeNfc([label, description]));
    // Reordering happened inside the field; the delimiter + next field are intact.
    expect(r.fields[1].text).toBe('y');
    expect(r.fields[1].start).toBe(r.fields[0].text.length + 2);
  });
});

describe('reconstructSeiContainer (recipe: facts[].claim joined by single LF)', () => {
  it('joins claims in array order with a single LF', () => {
    const r = reconstructSeiContainer(['a', 'b', 'c']);
    expect(r.text).toBe('a\nb\nc');
    expect(r.fields.map(f => f.start)).toEqual([0, 2, 4]);
  });

  it('omits an empty claim — no empty segment, no doubled delimiter', () => {
    expect(reconstructSeiContainer(['a', '', 'c']).text).toBe('a\nc');
  });
});

describe('buildFieldSegments — offset overlay + staleness guard', () => {
  // Container: 'OpenAI builds AI' + LFLF + 'The lab OpenAI ships models'
  const src = { label: 'OpenAI builds AI', description: 'The lab OpenAI ships models' };
  const { fields } = reconstructNodeContainer(src);
  const labelField = fields[0];       // start 0
  const descField = fields[1];        // start 18 (16 + 2)

  it('links a mention inside the label field and leaves the rest plain', () => {
    const segs = buildFieldSegments(labelField, [m('org-001', 'OpenAI', 0)]);
    expect(segs.map(s => [s.text, s.ref?.id])).toEqual([
      ['OpenAI', 'org-001'],
      [' builds AI', undefined],
    ]);
  });

  it('maps a GLOBAL offset in the second field to the right local slice', () => {
    // 'The lab ' = 8 chars → 'OpenAI' at descField.start(18) + 8 = 26
    const segs = buildFieldSegments(descField, [m('org-001', 'OpenAI', 26)]);
    expect(segs.map(s => [s.text, s.ref?.id])).toEqual([
      ['The lab ', undefined],
      ['OpenAI', 'org-001'],
      [' ships models', undefined],
    ]);
  });

  it('excludes mentions belonging to other fields', () => {
    // The description-field mention (offset 26) must not affect the label field.
    const segs = buildFieldSegments(labelField, [m('org-001', 'OpenAI', 26)]);
    expect(segs).toEqual([{ text: 'OpenAI builds AI' }]);
  });

  it('STALENESS GUARD: drops a mention whose quote no longer matches the text → plain', () => {
    const segs = buildFieldSegments(labelField, [m('org-001', 'Xpenai', 0)]);
    expect(segs).toEqual([{ text: 'OpenAI builds AI' }]); // no link
  });

  it('drops a mention with an unparseable entity_ref → plain', () => {
    const segs = buildFieldSegments(labelField, [m('not-a-real-token!!', 'OpenAI', 0)]);
    expect(segs).toEqual([{ text: 'OpenAI builds AI' }]);
  });

  it('renders multiple mentions in one field, sorted, with plain gaps', () => {
    // 'OpenAI builds AI': link 'OpenAI'(0) and 'AI'(14)
    const segs = buildFieldSegments(labelField, [m('org-002', 'AI', 14), m('org-001', 'OpenAI', 0)]);
    expect(segs.map(s => [s.text, s.ref?.id])).toEqual([
      ['OpenAI', 'org-001'],
      [' builds ', undefined],
      ['AI', 'org-002'],
    ]);
  });

  it('defends against overlapping mentions — the later overlap is skipped', () => {
    const segs = buildFieldSegments(labelField, [m('org-001', 'OpenAI', 0), m('org-002', 'penAI', 1)]);
    expect(segs.map(s => [s.text, s.ref?.id])).toEqual([
      ['OpenAI', 'org-001'],
      [' builds AI', undefined],
    ]);
  });

  it('a field with no mentions renders as a single plain segment', () => {
    expect(buildFieldSegments(labelField, [])).toEqual([{ text: 'OpenAI builds AI' }]);
  });
});
