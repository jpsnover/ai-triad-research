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
import { extractZodVocab, extractCorpusValues, extractPromptVocab } from './extractors.js';
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

// The exact CONTROLLED VOCABULARY block CL authored for renderer/prompts/analysis.ts (t/3455#3),
// embedded in representative prompt prose (preamble above, field-description prose + the DELIBERATELY
// out-of-fence rhetorical_strategy below — deferred until t/3448). A parser that reads only the fence
// must capture the 5 fields and nothing from the prose.
const ANALYSIS_PROMPT_FIXTURE = `You are analyzing a taxonomy node.

Generate a JSON object with these fields:

### CONTROLLED VOCABULARY (source of truth: lib/schema/taxonomy-schema.json) ###
# For fields tagged (CV) below, emit ONLY these exact values. Comma-separate where multi-valued.
epistemic_type = empirical_claim | strategic_recommendation | normative_prescription | interpretive_lens | predictive | definitional | causal_mechanism
node_scope = claim | scheme | bridging | narrow_technical | domain_specific | cross_domain | systemic
falsifiability = high | medium | low
emotional_register = cautionary | pragmatic | measured | urgent | alarmed | aspirational | optimistic | defiant | dismissive | assertive | resolute | analytical
audience = policymakers | technical_researchers | industry_leaders | academic_community | civil_society | general_public | labor_organizations
### END CONTROLLED VOCABULARY ###

  epistemic_type (string, pick ONE) (CV): the claim's epistemic modality.

  rhetorical_strategy (string, pick ONE): "precautionary_framing", "inevitability_framing", "cost_benefit_analysis"

  node_scope (string, pick ONE) (CV): claim = specific assertion; scheme = argumentative strategy.

Return ONLY valid JSON. No markdown fencing, no preamble.`;

describe('extractPromptVocab', () => {
  it('parses exactly the 5 fenced controlled-vocab fields, values only (no type)', () => {
    const ex = extractPromptVocab(ANALYSIS_PROMPT_FIXTURE, 'prompt:analysis.ts');
    expect(ex.kind).toBe('validator');
    expect(ex.source).toBe('prompt:analysis.ts');
    expect(ex.attributes?.epistemic_type?.values).toEqual([
      'empirical_claim', 'strategic_recommendation', 'normative_prescription',
      'interpretive_lens', 'predictive', 'definitional', 'causal_mechanism',
    ]);
    expect(ex.attributes?.node_scope?.values).toEqual([
      'claim', 'scheme', 'bridging', 'narrow_technical', 'domain_specific', 'cross_domain', 'systemic',
    ]);
    expect(ex.attributes?.falsifiability?.values).toEqual(['high', 'medium', 'low']);
    expect(ex.attributes?.emotional_register?.values).toHaveLength(12);
    expect(ex.attributes?.audience?.values).toEqual([
      'policymakers', 'technical_researchers', 'industry_leaders', 'academic_community',
      'civil_society', 'general_public', 'labor_organizations',
    ]);
    // The block declares the value-SET, not the storage type — no `type` emitted (so a
    // controlled_vocab_csv field like audience never fires a spurious type_mismatch).
    expect(ex.attributes?.audience?.type).toBeUndefined();
  });

  it('reads ONLY the fence: comment lines, prose, and the out-of-fence rhetorical_strategy are ignored', () => {
    const ex = extractPromptVocab(ANALYSIS_PROMPT_FIXTURE, 'prompt:analysis.ts');
    expect(Object.keys(ex.attributes ?? {}).sort()).toEqual([
      'audience', 'emotional_register', 'epistemic_type', 'falsifiability', 'node_scope',
    ]);
    expect(ex.attributes?.rhetorical_strategy).toBeUndefined(); // deferred, inline prose — never scraped
  });

  it('a prompt with no fence yields empty attributes (not an error)', () => {
    const ex = extractPromptVocab('Generate a JSON object. Return ONLY valid JSON.', 'prompt:other.ts');
    expect(ex.attributes).toEqual({});
  });

  it('only the FIRST fence is parsed when a prompt carries more than one', () => {
    const two = `### CONTROLLED VOCABULARY ###
falsifiability = high | medium | low
### END CONTROLLED VOCABULARY ###
### CONTROLLED VOCABULARY ###
audience = policymakers
### END CONTROLLED VOCABULARY ###`;
    const ex = extractPromptVocab(two, 'prompt:dup.ts');
    expect(ex.attributes?.falsifiability?.values).toEqual(['high', 'medium', 'low']);
    expect(ex.attributes?.audience).toBeUndefined();
  });

  it('end-to-end both-arms: parsed vocab drives checkSchemaDrift against a record', () => {
    // Synthetic record (deterministic; not coupled to the evolving real record's exact vocab).
    const rec: SchemaRecord = {
      graph_attributes: { falsifiability: { type: 'enum', values: ['high', 'medium', 'low'] } },
      edges: { canonical: [], deprecated_types: [] },
    };
    // CLEAN arm: a block whose value-set matches the record → zero findings.
    const clean = `### CONTROLLED VOCABULARY ###
falsifiability = high | medium | low
### END CONTROLLED VOCABULARY ###`;
    expect(checkSchemaDrift(rec, extractPromptVocab(clean, 'prompt:t.ts'))).toEqual([]);
    // DRIFT arm: an undeclared value + a missing declared value both fire (validator kind).
    const drift = `### CONTROLLED VOCABULARY ###
falsifiability = high | medium | severe
### END CONTROLLED VOCABULARY ###`;
    const f = checkSchemaDrift(rec, extractPromptVocab(drift, 'prompt:t.ts'));
    expect(f.some((x) => x.type === 'extra_in_consumer' && x.value === 'severe')).toBe(true);
    expect(f.some((x) => x.type === 'missing_in_consumer' && x.value === 'low')).toBe(true);
  });
});
