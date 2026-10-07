// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4052: the POV-tag proposal side file (spec t3935 §7.4), CL's semantics (e/269#3), and the byte-preservation
// Rosetta asked for (e/269): one decision leaves every other byte of a real-shaped file unchanged.

import { describe, it, expect } from 'vitest';
import {
  parsePovTagProposals, applyProposalDecision, serializePovTagProposals,
  type PovTagProposalsFile, type ApplyProposalDecisionResult,
} from './povTagProposals.js';
import type { PovTagRegistry } from './povTags.js';

const REGISTRY = {
  version: 1,
  povs: {
    skeptic: [
      { id: 'critical', label: 'Critical', soul_doc: 'skeptic.critical', description: 'd' },
      { id: 'institutional', label: 'Institutional', soul_doc: 'skeptic.institutional', description: 'd' },
    ],
  },
} as unknown as PovTagRegistry;

/** Shaped like the committed file: header, `run`, and items carrying the extra `crux` key. */
function realShaped(): PovTagProposalsFile {
  const item = (node_id: string, proposed: string[], crux: string | null) => ({
    node_id, proposed, confidence: 0.8, rationale: `why ${node_id} — “wing” é`, crux,
    status: 'pending', final: null, reviewed_by: null, reviewed_at: null,
  });
  return {
    version: 1,
    registry_version: 1,
    run: { ticket: 't/3962', model: 'm', prompt_version: 'v1', created_at: '2026-10-06T00:00:00Z' },
    proposals: [
      item('skp-beliefs-001', ['critical'], 'C1'),
      item('skp-desires-009', ['critical', 'institutional'], null),
      item('skp-intentions-004', [], 'C3'),
    ],
  } as unknown as PovTagProposalsFile;
}

const AT = '2026-10-07T12:00:00Z';
const ok = (r: ApplyProposalDecisionResult) => { if ('refused' in r) throw new Error(r.problems.join('; ')); return r; };
const refusal = (r: ApplyProposalDecisionResult) => { if (!('refused' in r)) throw new Error('expected a refusal'); return r; };

describe('parsePovTagProposals', () => {
  it('accepts the real shape and returns the same object, so unknown keys (crux, run) survive', () => {
    const raw = realShaped();
    const r = parsePovTagProposals(raw);
    expect(r).toEqual({ ok: true, file: raw });
    if (r.ok) expect(r.file).toBe(raw);
  });

  it('reports every problem: bad status, non-array proposed, bad final, duplicate node_id', () => {
    const raw = realShaped() as unknown as { proposals: Record<string, unknown>[] };
    raw.proposals[0].status = 'maybe';
    raw.proposals[1].proposed = 'critical';
    raw.proposals[2].final = 'x';
    raw.proposals.push({ ...raw.proposals[0], status: 'pending' });
    const r = parsePovTagProposals(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join('\n')).toMatch(/status must be one of/);
      expect(r.problems.join('\n')).toMatch(/proposed must be an array/);
      expect(r.problems.join('\n')).toMatch(/final must be null or an array/);
      expect(r.problems.join('\n')).toMatch(/duplicate node_id skp-beliefs-001/);
    }
  });

  it('rejects a non-object and a missing proposals array', () => {
    expect(parsePovTagProposals([]).ok).toBe(false);
    expect(parsePovTagProposals({ version: 1 }).ok).toBe(false);
  });
});

describe('applyProposalDecision: the spec §7.4 status rules', () => {
  it('accepted: final = proposed', () => {
    const r = ok(applyProposalDecision(realShaped(), 'skp-desires-009', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY));
    expect(r.item).toMatchObject({ status: 'accepted', final: ['critical', 'institutional'], reviewed_by: 'ed', reviewed_at: AT });
  });

  it('rejected: final = [] (intentionally untagged); a non-empty final is refused', () => {
    expect(ok(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'rejected' }, 'ed', AT, 'pending', REGISTRY)).item.final).toEqual([]);
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'rejected', final: ['critical'] }, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
  });

  it('modified: stores the new final', () => {
    const r = ok(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'modified', final: ['institutional'] }, 'ed', AT, 'pending', REGISTRY));
    expect(r.item).toMatchObject({ status: 'modified', final: ['institutional'] });
  });

  it('modified with final equal to proposed AS A SET is refused, never stored as modified (CL e/269#3)', () => {
    const r = refusal(applyProposalDecision(realShaped(), 'skp-desires-009', { status: 'modified', final: ['institutional', 'critical'] }, 'ed', AT, 'pending', REGISTRY));
    expect(r.refused).toBe('invalid');
    expect(r.problems[0]).toMatch(/record it as accepted/);
  });

  it('a duplicated final of the same length is not the proposed set: it fails tag validation, not the accepted rule', () => {
    const r = refusal(applyProposalDecision(realShaped(), 'skp-desires-009', { status: 'modified', final: ['critical', 'critical'] }, 'ed', AT, 'pending', REGISTRY));
    expect(r.refused).toBe('invalid');
    expect(r.problems.join(' ')).not.toMatch(/record it as accepted/);
  });

  it('a duplicate in final is not mistaken for the proposed set', () => {
    const r = ok(applyProposalDecision(realShaped(), 'skp-desires-009', { status: 'modified', final: ['critical'] }, 'ed', AT, 'pending', REGISTRY));
    expect(r.item.final).toEqual(['critical']);
  });

  it('modified needs a final; accepted with a different final is refused', () => {
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'modified' }, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted', final: ['institutional'] }, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
  });

  it('final must pass validatePovTagsDetailed for the node POV: an unregistered tag is refused, also on accept', () => {
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'modified', final: ['nope'] }, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
    const retired = { version: 1, povs: { skeptic: [{ id: 'institutional', label: 'I', soul_doc: 'skeptic.institutional', description: 'd' }] } } as unknown as PovTagRegistry;
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted' }, 'ed', AT, 'pending', retired)).refused).toBe('invalid');
  });

  it('accepting an empty proposal is allowed and records final = []', () => {
    expect(ok(applyProposalDecision(realShaped(), 'skp-intentions-004', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY)).item.final).toEqual([]);
  });
});

describe('applyProposalDecision: refusals', () => {
  it('conflict when the current status is not the expected one (someone reviewed it since load)', () => {
    const first = ok(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY));
    const r = refusal(applyProposalDecision(first.file, 'skp-beliefs-001', { status: 'rejected' }, 'ed2', AT, 'pending', REGISTRY));
    expect(r.refused).toBe('conflict');
  });

  it('a re-review that names the current status is allowed', () => {
    const first = ok(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY));
    expect(ok(applyProposalDecision(first.file, 'skp-beliefs-001', { status: 'rejected' }, 'ed2', AT, 'accepted', REGISTRY)).item.status).toBe('rejected');
  });

  it('invalid for an unknown node, an empty reviewer, a bad timestamp or a bad status', () => {
    expect(refusal(applyProposalDecision(realShaped(), 'skp-nope-999', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted' }, '  ', AT, 'pending', REGISTRY)).refused).toBe('invalid');
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'accepted' }, 'ed', 'yesterday', 'pending', REGISTRY)).refused).toBe('invalid');
    expect(refusal(applyProposalDecision(realShaped(), 'skp-beliefs-001', { status: 'pending' } as never, 'ed', AT, 'pending', REGISTRY)).refused).toBe('invalid');
  });
});

describe('byte preservation (Rosetta e/269)', () => {
  it('one decision changes exactly that item\'s four review fields; every other byte is identical', () => {
    const before = realShaped();
    const committed = serializePovTagProposals(before);
    const r = ok(applyProposalDecision(JSON.parse(committed), 'skp-desires-009', { status: 'modified', final: ['critical'] }, 'ed', AT, 'pending', REGISTRY));
    const after = serializePovTagProposals(r.file);

    // Rebuild the expected text by editing only those four fields of that one item, then compare whole files.
    const expected = JSON.parse(committed);
    Object.assign(expected.proposals[1], { status: 'modified', final: ['critical'], reviewed_by: 'ed', reviewed_at: AT });
    expect(after).toBe(serializePovTagProposals(expected));

    // And the untouched items serialize to the same bytes as before.
    const block = (text: string, i: number) => JSON.stringify(JSON.parse(text).proposals[i], null, 2);
    expect(block(after, 0)).toBe(block(committed, 0));
    expect(block(after, 2)).toBe(block(committed, 2));
    // Key order of the reviewed item is unchanged (crux stays where it was).
    expect(Object.keys(JSON.parse(after).proposals[1])).toEqual(Object.keys(JSON.parse(committed).proposals[1]));
  });

  it('never mutates its input', () => {
    const input = realShaped();
    const snapshot = JSON.stringify(input);
    applyProposalDecision(input, 'skp-beliefs-001', { status: 'accepted' }, 'ed', AT, 'pending', REGISTRY);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('compares BYTES, not strings: multi-byte UTF-8 (em dash, curly quotes) is written raw, never escaped (Rosetta e/269#10)', () => {
    const committed = Buffer.from(serializePovTagProposals(realShaped()), 'utf8');
    const text = committed.toString('utf8');
    expect(committed.length).toBeGreaterThan(text.length); // the fixture really carries multi-byte characters
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/); // no JSON \uXXXX escapes
    expect(text).toContain('—'); // the em dash is written as the character itself
    // Round trip at the byte level.
    expect(Buffer.from(serializePovTagProposals(JSON.parse(text)), 'utf8').equals(committed)).toBe(true);
    // A decision on one item: rebuilding the expected file by editing only that item's review fields gives identical bytes.
    const r = ok(applyProposalDecision(JSON.parse(text), 'skp-beliefs-001', { status: 'rejected' }, 'ed', AT, 'pending', REGISTRY));
    const expected = JSON.parse(text);
    Object.assign(expected.proposals[0], { status: 'rejected', final: [], reviewed_by: 'ed', reviewed_at: AT });
    expect(Buffer.from(serializePovTagProposals(r.file), 'utf8').equals(Buffer.from(serializePovTagProposals(expected), 'utf8'))).toBe(true);
  });

  it('the serializer round-trips the committed format: 2-space JSON plus one trailing LF', () => {
    const text = serializePovTagProposals(realShaped());
    expect(serializePovTagProposals(JSON.parse(text))).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).not.toContain('\r');
  });
});

// ── value_basis* (t/4066, SO e/278#2 conditions 1 and 3) ─────────────────────────────────────────────────────────
/** realShaped plus the justify-pass fields: a run snapshot (critical/institutional 4 elements, shared 3) and per-item bases. */
function withValueBasis(): PovTagProposalsFile {
  const f = realShaped() as unknown as Record<string, unknown> & { proposals: Record<string, unknown>[] };
  f.value_basis_run = {
    model: 'm', prompt_version: 'justify-v3', index_base: 1,
    value_hierarchies: { critical: ['c1', 'c2', 'c3', 'c4'], institutional: ['i1', 'i2', 'i3', 'i4'], shared: ['s1', 's2', 's3'] },
    soul_provenance: { critical: { file: 'skeptic.critical.soul.json', hash: 'fnv1a64:0123456789abcdef' } },
  };
  f.proposals[0].value_basis = [{ tag: 'critical', vh_index: [1, 4], vh_index_uncertain: [2], why: 'w', unsupported: false }];
  f.proposals[1].value_basis = [
    { tag: 'critical', vh_index: null, vh_index_uncertain: [], why: 'w', unsupported: true },
    { tag: 'institutional', vh_index: [], vh_index_uncertain: [4], why: 'w', unsupported: false },
  ];
  f.proposals[1].value_basis_shared = { vh_index: [3], vh_index_uncertain: [], why: 'w', unsupported: false };
  f.proposals[2].value_basis_nearest = { tag: 'institutional', vh_index: 1, why: 'w', agree: true };
  return f as unknown as PovTagProposalsFile;
}
type Mutable = { value_basis_run: Record<string, unknown>; proposals: Record<string, Record<string, unknown> & { value_basis?: Record<string, unknown>[] }>[] };
const problemsOf = (mutate: (f: Mutable) => void) => {
  const f = withValueBasis() as unknown as Mutable;
  mutate(f);
  const r = parsePovTagProposals(f);
  return r.ok ? [] : r.problems;
};

describe('value_basis*: shape and 1-based bounds (SO e/278#2 cond. 1)', () => {
  it('accepts a well-formed justify pass and returns the same object; null and [] indices are fine', () => {
    const raw = withValueBasis();
    const r = parsePovTagProposals(raw);
    expect(r).toEqual({ ok: true, file: raw });
  });

  it('refuses an out-of-range index, and index 0 (1-based), in firm and uncertain lists', () => {
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].vh_index = [5]; })).toEqual([expect.stringMatching(/vh_index: 5 out of range 1\.\.4 \(indices are 1-based\)/)]);
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].vh_index = [0]; })).toEqual([expect.stringMatching(/0 out of range/)]);
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].vh_index_uncertain = [9]; })).toEqual([expect.stringMatching(/vh_index_uncertain: 9 out of range/)]);
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].vh_index = [1.5]; })).toEqual([expect.stringMatching(/1\.5 out of range/)]);
  });

  it('bounds come from the MATCHING array: shared has 3 elements, so 4 is refused there though valid for a wing tag', () => {
    expect(problemsOf((f) => { f.proposals[1].value_basis_shared = { vh_index: [4], vh_index_uncertain: [], why: 'w', unsupported: false }; }))
      .toEqual([expect.stringMatching(/value_basis_shared\.vh_index: 4 out of range 1\.\.3/)]);
  });

  it('value_basis_nearest: a null tag needs a null index; a tagged index is bounds-checked', () => {
    expect(problemsOf((f) => { f.proposals[2].value_basis_nearest = { tag: null, vh_index: null, why: 'w', agree: false }; })).toEqual([]);
    expect(problemsOf((f) => { f.proposals[2].value_basis_nearest = { tag: null, vh_index: 1, why: 'w', agree: false }; }))
      .toEqual([expect.stringMatching(/vh_index must be null when tag is null/)]);
    expect(problemsOf((f) => { f.proposals[2].value_basis_nearest = { tag: 'critical', vh_index: 7, why: 'w', agree: true }; }))
      .toEqual([expect.stringMatching(/value_basis_nearest\.vh_index: 7 out of range/)]);
  });

  it('refuses value_basis without a run snapshot, a tag with no snapshot, and a malformed soul_provenance', () => {
    expect(problemsOf((f) => { delete (f as Partial<Mutable>).value_basis_run; })[0]).toMatch(/no usable value_basis_run/);
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].tag = 'nope'; })[0]).toMatch(/no value_hierarchies snapshot for tag "nope"/);
    expect(problemsOf((f) => { f.value_basis_run.soul_provenance = { critical: { file: 'x' } }; })[0]).toMatch(/soul_provenance must map/);
    expect(problemsOf((f) => { f.value_basis_run.index_base = 0; })[0]).toMatch(/index_base must be 1/);
  });

  it('unsupported must agree with the indices (CL e/278#11): no contradictory justification, in value_basis or shared', () => {
    expect(problemsOf((f) => { f.proposals[0].value_basis![0].unsupported = true; }))
      .toEqual([expect.stringMatching(/unsupported is true, but it must equal/)]);
    expect(problemsOf((f) => { f.proposals[1].value_basis![0].unsupported = false; }))
      .toEqual([expect.stringMatching(/unsupported is false, but it must equal/)]);
    expect(problemsOf((f) => { f.proposals[1].value_basis_shared = { vh_index: null, vh_index_uncertain: [2], why: 'w', unsupported: true }; }))
      .toEqual([expect.stringMatching(/value_basis_shared\.unsupported is true/)]);
  });

  it('refuses missing why / unsupported / vh_index_uncertain', () => {
    const p = problemsOf((f) => { f.proposals[0].value_basis = [{ tag: 'critical', vh_index: [1] }]; });
    expect(p).toEqual(expect.arrayContaining([
      expect.stringMatching(/vh_index_uncertain must be an array/), expect.stringMatching(/why must be a string/), expect.stringMatching(/unsupported must be a boolean/),
    ]));
  });
});

describe('value_basis*: a reviewer decision never rewrites the justification (SO e/278#2 cond. 3)', () => {
  const vbBytes = (item: Record<string, unknown>) =>
    JSON.stringify([item.value_basis, item.value_basis_shared, item.value_basis_nearest]);

  it.each([
    ['accepted', 'skp-desires-009', { status: 'accepted' as const }],
    ['modified', 'skp-desires-009', { status: 'modified' as const, final: ['critical'] }],
    ['rejected', 'skp-desires-009', { status: 'rejected' as const }],
  ])('%s keeps value_basis* byte-identical, and the run block too', (_n, id, decision) => {
    const before = withValueBasis();
    const original = before.proposals.find((p) => p.node_id === id)!;
    const r = ok(applyProposalDecision(before, id, decision, 'ed', AT, 'pending', REGISTRY));
    expect(vbBytes(r.item)).toBe(vbBytes(original));
    expect(JSON.stringify(r.file.value_basis_run)).toBe(JSON.stringify(before.value_basis_run));
  });
});
