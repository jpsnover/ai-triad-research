// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// Extractor tests (t/3453): extractZodVocab introspects the real lib/debate Zod enums; extractCorpusValues
// reads a tmp fixture corpus (no ai-triad-data dependency). End-to-end, we run an extraction through
// checkSchemaDrift to prove the corpus's known-defect drift surfaces as Findings.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { extractZodVocab, extractCorpusValues } from './extractors.js';
import { checkSchemaDrift, type SchemaRecord } from './checkSchemaDrift.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RECORD = JSON.parse(
  readFileSync(fileURLToPath(new URL('./taxonomy-schema.json', import.meta.url)), 'utf-8'),
) as SchemaRecord;

describe('extractZodVocab', () => {
  it('reports the lib Zod node_scope enum + the 8 canonical edge types via .options', () => {
    const ex = extractZodVocab();
    expect(ex.kind).toBe('validator');
    expect(ex.attributes?.node_scope?.values).toEqual(['claim', 'scheme', 'bridging']);
    expect(ex.edgeTypes).toContain('SUPPORTS');
    expect(ex.edgeTypes).toContain('CONVERGES_WITH');
    expect(ex.edgeTypes).toHaveLength(8);
  });

  it('through the comparator, surfaces the node_scope drift (Zod has 3, record has 7)', () => {
    const findings = checkSchemaDrift(RECORD, extractZodVocab());
    // The record declares 7 node_scope values; Zod encodes 3 → 4 missing_in_consumer on node_scope.
    const nsMissing = findings.filter((f) => f.type === 'missing_in_consumer' && f.field === 'graph_attributes.node_scope');
    expect(nsMissing.length).toBe(4);
    expect(nsMissing.map((f) => f.value).sort()).toEqual(['cross_domain', 'domain_specific', 'narrow_technical', 'systemic']);
  });
});

describe('extractCorpusValues', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reads distinct graph-attr values (CSV-split) + edge types from a fixture corpus', () => {
    dir = mkdtempSync(join(tmpdir(), 'origin-'));
    writeFileSync(join(dir, 'accelerationist.json'), JSON.stringify({ nodes: [
      { id: 'acc-beliefs-001', graph_attributes: {
        epistemic_type: 'empirical_claim',
        rhetorical_strategy: 'appeal_to_evidence, techno_optimism',
        steelman_vulnerability: 'a string one',
      } },
    ] }));
    writeFileSync(join(dir, 'safetyist.json'), JSON.stringify({ nodes: [
      { id: 'saf-beliefs-001', graph_attributes: {
        epistemic_type: 'predictive',
        rhetorical_strategy: 'pragmatic_framing', // drift variant (t/3448 class)
        steelman_vulnerability: { rebuttal: 'a dict one' }, // type-drift (t/3449 class)
      } },
    ] }));
    // skeptic.json intentionally absent → best-effort skip, not fatal.
    writeFileSync(join(dir, 'edges.json'), JSON.stringify({ edges: [{ type: 'SUPPORTS' }, { type: 'CONVERGES_WITH' }] }));

    const ex = extractCorpusValues(dir);
    expect(ex.kind).toBe('corpus');
    expect(ex.attributes?.epistemic_type?.values).toEqual(['empirical_claim', 'predictive']);
    expect(ex.attributes?.rhetorical_strategy?.values).toEqual(['appeal_to_evidence', 'pragmatic_framing', 'techno_optimism']);
    // steelman_vulnerability observed as BOTH string and object → mixed type marker.
    expect(ex.attributes?.steelman_vulnerability?.type).toBe('object|string');
    expect(ex.edgeTypes).toEqual(['CONVERGES_WITH', 'SUPPORTS']);
  });

  it('end-to-end: corpus drift surfaces through the comparator (extra value + type_mismatch)', () => {
    dir = mkdtempSync(join(tmpdir(), 'origin-'));
    writeFileSync(join(dir, 'accelerationist.json'), JSON.stringify({ nodes: [
      { id: 'acc-beliefs-001', graph_attributes: { rhetorical_strategy: 'pragmatic_framing', steelman_vulnerability: { x: 1 } } },
    ] }));
    const findings = checkSchemaDrift(RECORD, extractCorpusValues(dir));
    expect(findings.some((f) => f.type === 'extra_in_consumer' && f.value === 'pragmatic_framing')).toBe(true);
    expect(findings.some((f) => f.type === 'type_mismatch' && f.field === 'graph_attributes.steelman_vulnerability')).toBe(true);
  });
});
