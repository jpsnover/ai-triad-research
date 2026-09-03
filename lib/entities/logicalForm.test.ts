// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Definition-level tests for the canonical logical_form schema (t/3250). Both arms:
// the doc's canonical example PARSES; every closed vocabulary REJECTS an out-of-vocab value;
// required-field omission rejects (schema doc rule 4 "an absent field is a formalization bug");
// modality:null (factual) is accepted; passthrough forgives additive unknown keys. The
// bidirectional type-equality guards are compile-time (they fail `tsc`, not vitest) — a note
// documents that so a future reader knows drift is caught at build, not here.
import { describe, it, expect } from 'vitest';
import { logicalFormSchema, type LogicalForm } from './logicalForm.js';

// The canonical example from research/comp-linguist/docs/logical-form-schema.md §Schema, verbatim.
const CANONICAL: LogicalForm = {
  predicate: 'acquire',
  event_ref: 'e1',
  args: [
    { role: 'agent', ref: 'ent-034', sort: 'agentive-physical-object', match_level: 'exact' },
    { role: 'patient', ref: 'ent-055', sort: 'non-agentive-functional-artifact', match_level: 'exact' },
  ],
  polarity: 'positive',
  modality: { holder: 'camp:acc', attitude: 'belief' },
  temporal: { type: 'at', value: '2025-02' },
  about: [{ ref: 'ent-055', match_level: 'exact' }],
  formalization_confidence: 0.85,
  status: 'proposed',
};

describe('logicalFormSchema — valid arm', () => {
  it('parses the canonical doc example', () => {
    const r = logicalFormSchema.safeParse(CANONICAL);
    expect(r.success).toBe(true);
  });

  it('accepts modality: null (factual_claims — unattributed fact)', () => {
    const r = logicalFormSchema.safeParse({ ...CANONICAL, modality: null });
    expect(r.success).toBe(true);
  });

  it('accepts temporal.value: null when type is unspecified', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      temporal: { type: 'unspecified', value: null },
    });
    expect(r.success).toBe(true);
  });

  it('accepts an omitted about[] (additive/optional)', () => {
    const { about: _drop, ...noAbout } = CANONICAL;
    const r = logicalFormSchema.safeParse(noAbout);
    expect(r.success).toBe(true);
  });

  it('passthrough: forgives an additive unknown key (forward-compat)', () => {
    const r = logicalFormSchema.safeParse({ ...CANONICAL, some_future_field: 42 });
    expect(r.success).toBe(true);
  });
});

describe('logicalFormSchema — reject arm (closed vocabularies strictly validated)', () => {
  it('rejects an out-of-vocab args[].role', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      args: [{ role: 'experiencer', ref: 'ent-034', sort: 'agentive-physical-object', match_level: 'exact' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-vocab args[].sort (DolceCategory)', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      args: [{ role: 'agent', ref: 'ent-034', sort: 'physical-object', match_level: 'exact' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-vocab args[].match_level (EntityMatchLevel)', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      args: [{ role: 'agent', ref: 'ent-034', sort: 'agentive-physical-object', match_level: 'fuzzy' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-vocab polarity', () => {
    const r = logicalFormSchema.safeParse({ ...CANONICAL, polarity: 'neutral' });
    expect(r.success).toBe(false);
  });

  it('rejects a bad modality.attitude', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      modality: { holder: 'camp:acc', attitude: 'hope' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a bad modality.holder', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      modality: { holder: 'camp:xyz', attitude: 'belief' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-vocab temporal.type', () => {
    const r = logicalFormSchema.safeParse({
      ...CANONICAL,
      temporal: { type: 'whenever', value: '2025-02' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-vocab status (formalization lifecycle)', () => {
    const r = logicalFormSchema.safeParse({ ...CANONICAL, status: 'linked' });
    expect(r.success).toBe(false);
  });

  it('rejects a required-field omission (missing predicate — rule 4)', () => {
    const { predicate: _drop, ...noPredicate } = CANONICAL;
    const r = logicalFormSchema.safeParse(noPredicate);
    expect(r.success).toBe(false);
  });

  it('rejects an omitted (not just null) modality — present-but-nullable, never absent', () => {
    const { modality: _drop, ...noModality } = CANONICAL;
    const r = logicalFormSchema.safeParse(noModality);
    expect(r.success).toBe(false);
  });

  it('rejects formalization_confidence out of [0,1]', () => {
    const r = logicalFormSchema.safeParse({ ...CANONICAL, formalization_confidence: 1.5 });
    expect(r.success).toBe(false);
  });
});
