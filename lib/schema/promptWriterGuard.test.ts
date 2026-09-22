// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node
// t/3550 — the prompt-writer guard closes the silent-new-writer gap. Both arms: a registered writer
// with a current fence produces nothing; a fence going missing/stale fires; an UN-registered file that
// emits controlled-vocab values without a fence fires (the gap); a reader (names fields but no
// JSON-output cue) does NOT false-positive (AC3). Plus a live check that the 3 real registered writers
// currently carry record-matching fences (AC1). CL co-signed the registry + 6-field derivation (t/3550#2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  controlledVocabFields,
  classifyPrompt,
  runPromptWriterGuard,
  WRITER_REGISTRY,
  COMPANION_EXEMPT,
  type PromptFile,
} from './promptWriterGuard.js';
import { checkSchemaDrift, type SchemaRecord } from './checkSchemaDrift.js';
import { extractPromptVocab } from './extractors.js';

const RECORD = JSON.parse(
  readFileSync(fileURLToPath(new URL('./taxonomy-schema.json', import.meta.url)), 'utf-8'),
) as SchemaRecord;

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const FENCE = (body: string) => `### CONTROLLED VOCABULARY ###\n${body}\n### END CONTROLLED VOCABULARY ###`;

describe('controlledVocabFields — derived from the record (SSOT)', () => {
  it('yields exactly the 6 controlled-vocab graph_attributes incl. falsifiability (CL-confirmed t/3550#2)', () => {
    expect(controlledVocabFields(RECORD).sort()).toEqual([
      'audience', 'emotional_register', 'epistemic_type', 'falsifiability', 'node_scope', 'rhetorical_strategy',
    ]);
  });
});

describe('classifyPrompt', () => {
  const fields = controlledVocabFields(RECORD);

  it('a fenced prompt → writer-fenced', () => {
    const f: PromptFile = { path: 'x/foo.prompt', content: FENCE('falsifiability = high | medium | low') };
    expect(classifyPrompt(f, fields).cls).toBe('writer-fenced');
  });

  it('no fence + ≥2 vocab fields + emit-signal (graph_attributes) → writer-unfenced', () => {
    const f: PromptFile = { path: 'x/new.prompt', content: 'Emit graph_attributes: set epistemic_type and node_scope for the node.' };
    const c = classifyPrompt(f, fields);
    expect(c.cls).toBe('writer-unfenced');
    expect(c.matchedFields.sort()).toEqual(['epistemic_type', 'node_scope']);
  });

  it('no fence + emit-signal via JSON-key vocab emission ("epistemic_type": …) → writer-unfenced', () => {
    const f: PromptFile = { path: 'x/schema.prompt', content: 'Output shape:\n{ "epistemic_type": "empirical_claim", "node_scope": "claim" }' };
    expect(classifyPrompt(f, fields).cls).toBe('writer-unfenced');
  });

  it('composes a registered vocab fragment ({{attribute-vocabulary}}) → writer-fenced (inherits the fence)', () => {
    const f: PromptFile = { path: 'x/single.prompt', content: '{{attribute-vocabulary}}\nThe epistemic_type and rhetorical_strategy emitted into graph_attributes.' };
    expect(classifyPrompt(f, fields).cls).toBe('writer-fenced');
  });

  it('a READER (names ≥2 fields but no emit-signal) → non-writer (AC3: no false positive)', () => {
    // Mirrors the real hierarchy-proposal.prompt false-positive: references fields as grouping context,
    // emits hierarchy not vocab (no graph_attributes, no "field": JSON-key emission).
    const f: PromptFile = { path: 'x/hierarchy.prompt', content: 'Nodes sharing the same epistemic_type or audience likely belong under the same parent. Return the hierarchy.' };
    expect(classifyPrompt(f, fields).cls).toBe('non-writer');
  });

  it('only ONE vocab field + emit-signal → non-writer (needs ≥2 to look like a writer)', () => {
    const f: PromptFile = { path: 'x/one.prompt', content: 'Emit graph_attributes with epistemic_type only.' };
    expect(classifyPrompt(f, fields).cls).toBe('non-writer');
  });
});

describe('runPromptWriterGuard — registered-writer obligations (a)', () => {
  const reg = WRITER_REGISTRY[0];
  const findings = (files: PromptFile[]) => runPromptWriterGuard(files, RECORD);

  it('a registered writer with a valid, record-subset fence → no finding', () => {
    const files: PromptFile[] = [{ path: reg, content: FENCE('falsifiability = high | medium | low') }];
    // Other registered writers are absent here → expect their registered_writer_missing, but NOT one for `reg`.
    const findings = runPromptWriterGuard(files, RECORD);
    expect(findings.some((f) => f.path === reg)).toBe(false);
  });

  it('a registered writer that lost its fence → registered_writer_no_fence', () => {
    const files: PromptFile[] = [{ path: reg, content: 'Generate a JSON object. No fence here.' }];
    expect(findings(files).some((f) => f.path === reg && f.type === 'registered_writer_no_fence')).toBe(true);
  });

  it('a registered writer whose fence declares a NON-record value → registered_writer_fence_drift', () => {
    const files: PromptFile[] = [{ path: reg, content: FENCE('epistemic_type = empirical_claim | totally_made_up') }];
    const drift = findings(files).find((f) => f.path === reg && f.type === 'registered_writer_fence_drift');
    expect(drift).toBeDefined();
    expect(drift!.fields).toContain('totally_made_up');
  });

  it('a registered writer absent from the scanned set → registered_writer_missing', () => {
    expect(findings([]).filter((f) => f.type === 'registered_writer_missing').length).toBe(WRITER_REGISTRY.length);
  });
});

describe('runPromptWriterGuard — the silent-new-writer gap (b)', () => {
  const registeredStub: PromptFile[] = WRITER_REGISTRY.map((p) => ({ path: p, content: FENCE('falsifiability = high | medium | low') }));

  it('an UN-registered writer-looking file with no fence → unregistered_writer naming the fields', () => {
    const files = [
      ...registeredStub,
      { path: 'taxonomy-editor/src/renderer/prompts/newThing.ts', content: 'Emit into graph_attributes: epistemic_type and rhetorical_strategy.' },
    ];
    const gap = runPromptWriterGuard(files, RECORD).find((f) => f.type === 'unregistered_writer');
    expect(gap).toBeDefined();
    expect(gap!.path).toBe('taxonomy-editor/src/renderer/prompts/newThing.ts');
    expect(gap!.fields!.sort()).toEqual(['epistemic_type', 'rhetorical_strategy']);
  });

  it('an un-registered READER file → no unregistered_writer (AC3)', () => {
    const files = [
      ...registeredStub,
      { path: 'lib/debate/turnPipeline/opening.ts', content: 'Plan using epistemic_type, node_scope, audience as context. Emit a debate turn.' },
    ];
    expect(runPromptWriterGuard(files, RECORD).some((f) => f.type === 'unregistered_writer')).toBe(false);
  });

  it('an un-registered file that COMPOSES the vocab fragment → no unregistered_writer (inherits fence)', () => {
    const files = [
      ...registeredStub,
      { path: 'scripts/AITriad/Prompts/attribute-extraction-single.prompt', content: '{{attribute-vocabulary}}\nEmit graph_attributes: epistemic_type, rhetorical_strategy.' },
    ];
    expect(runPromptWriterGuard(files, RECORD).some((f) => f.type === 'unregistered_writer')).toBe(false);
  });

  it('a COMPANION_EXEMPT file that trips the writer heuristic → no unregistered_writer (CL ruling t/3550#4)', () => {
    // attribute-extraction-schema.prompt emits all 6 vocab fields as JSON keys, but its vocab authority
    // is the fenced attribute-extraction.prompt it always ships with — fencing it too would duplicate the
    // enum. Exempted, not registered.
    const companion = COMPANION_EXEMPT[0];
    const files = [
      ...registeredStub,
      { path: companion, content: 'Output shape:\n{ "epistemic_type": "empirical_claim", "node_scope": "claim", "rhetorical_strategy": "appeal_to_evidence" }' },
    ];
    // Would classify writer-unfenced on its own …
    expect(classifyPrompt(files.at(-1)!, controlledVocabFields(RECORD)).cls).toBe('writer-unfenced');
    // … but the guard exempts it → no finding.
    expect(runPromptWriterGuard(files, RECORD).some((f) => f.path === companion)).toBe(false);
  });
});

describe('runPromptWriterGuard — live: the 3 real registered writers carry record-matching fences (AC1)', () => {
  it('no registered_writer_no_fence / _missing / _fence_drift for any real writer', () => {
    const files: PromptFile[] = WRITER_REGISTRY.map((p) => ({ path: p, content: readFileSync(join(REPO_ROOT, p), 'utf-8') }));
    const regFindings = runPromptWriterGuard(files, RECORD).filter((f) => f.type.startsWith('registered_writer'));
    expect(regFindings).toEqual([]);
  });

  it('sanity: each real registered writer parses a record-clean fence via checkSchemaDrift', () => {
    for (const p of WRITER_REGISTRY) {
      const content = readFileSync(join(REPO_ROOT, p), 'utf-8');
      // No extra_in_consumer: every fenced value is canonical per the record.
      const extra = checkSchemaDrift(RECORD, extractPromptVocab(content, `prompt:${p}`)).filter((d) => d.type === 'extra_in_consumer');
      expect(extra).toEqual([]);
    }
  });
});
