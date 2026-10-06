// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Schema-drift comparator (t/3453, t/3447 Ticket B). Pure function: diffs the declarative
// schema-of-record (lib/schema/taxonomy-schema.json) against a vocabulary EXTRACTED from one
// consumer surface (a Zod/TS validator, or the live corpus). Returns typed Findings; NO IO, NO CI
// wiring here (that's a separate DevOps follow-up), and NO PowerShell logic twin — the later PS
// runner shells this JS (SO condition 2, t/3447#5).
//
// NET-NOT-GATE (SO risk 1, t/3447#5): a run that returns ZERO findings means the consumers do not
// DIVERGE from the record — it does NOT mean the schema is CORRECT. Correctness is a human ontology
// judgment (CL+TL). Green attests consistency, not correctness. Do not read "0 findings" as "schema good".
//
// The comparator compares VALUE SETS and TYPES only. It NEVER reads snapshot/coverage fields
// (cov_at_snapshot, corpus_snapshot) — they are informational by design (schema meta.snapshot_note).

// ── The record (only the fields the comparator reads; the file has more) ──────────────────────
export interface RecordAttribute {
  type: string;                 // 'enum' | 'controlled_vocab_csv' | 'array' | 'string' | 'object' | 'number' | 'boolean'
  values?: string[];            // closed set for `enum`
  atomic_values?: string[];     // closed set for `controlled_vocab_csv`
  status?: 'active' | 'deprecated' | 'transient' | 'removed';
}
/** A normative TOP-LEVEL node field (record `node_fields`, added 4.1.0, t/3955). */
export interface RecordNodeField {
  type: string;                 // e.g. 'array'
  elem?: string;
  /** Which nodes may carry it. 'pov' = acc-/saf-/skp- only, REJECTED on situations. */
  applies_to: 'pov' | 'situation' | 'all';
  status?: 'active' | 'deprecated' | 'transient' | 'removed';
}
export interface SchemaRecord {
  graph_attributes: Record<string, RecordAttribute>;
  edges: { canonical: { type: string }[]; deprecated_types: string[] };
  node_id?: { pov?: string[]; category?: string[] };
  /** Keyed by field name; `_`-prefixed keys (e.g. `_doc`) are notes, not fields. */
  node_fields?: Record<string, RecordNodeField | string>;
}

// ── What an extractor produces for ONE surface ────────────────────────────────────────────────
export interface ExtractedAttribute {
  /** Observed value-set (enum/controlled-vocab members a validator allows, or distinct values a
   *  corpus uses). Omit when the surface does not constrain/observe this attribute's values. */
  values?: string[];
  /** Observed runtime/declared type, comparable to RecordAttribute.type. Omit when unknown. */
  type?: string;
}
export interface Extracted {
  /** Surface label, echoed into every Finding.source (e.g. 'zod:validation.ts', 'ts:taxonomyTypes', 'corpus'). */
  source: string;
  /**
   * How to read this surface (disambiguates which Finding types apply):
   *  - 'validator' — a Zod/TS surface that SHOULD encode every record value. record-value-not-here =
   *    missing_in_consumer; here-value-not-in-record = extra_in_consumer; type differs = type_mismatch.
   *  - 'corpus'    — live data. here-value-not-in-record = extra_in_consumer (real drift); a record
   *    value merely UNUSED by the corpus is NOT a finding; a deprecated record field/value observed
   *    in use = deprecated_in_use.
   */
  kind: 'validator' | 'corpus';
  /** By graph_attribute field name. */
  attributes?: Record<string, ExtractedAttribute>;
  /** Observed edge-type names (a validator's allowed set, or the corpus's distinct set). */
  edgeTypes?: string[];
  /** Observed node-id pov/category value-sets, where the surface encodes them. */
  nodeId?: { pov?: string[]; category?: string[] };
  /**
   * Top-level node fields, per node kind (t/3955). Omit a kind the surface does not cover.
   *  - validator: every key the POV / situation schema declares. `accepts: false` = declared to REJECT a
   *    present value (e.g. z.never). A key that is not listed is NOT rejected: a plain z.object strips it.
   *  - corpus: every key observed on at least one node of that kind, with its runtime type(s).
   */
  nodeFields?: { pov?: Record<string, NodeFieldObservation>; situation?: Record<string, NodeFieldObservation> };
}
export interface NodeFieldObservation {
  /** Declared/observed type, comparable to RecordNodeField.type. Omit when unknown. */
  type?: string;
  /** Validator: does the schema accept a present value? Corpus: always true (it was observed). */
  accepts: boolean;
}

export type FindingType = 'missing_in_consumer' | 'extra_in_consumer' | 'type_mismatch' | 'deprecated_in_use';
export interface Finding {
  type: FindingType;
  /** Dotted path into the record, e.g. 'graph_attributes.epistemic_type' | 'edges' | 'node_id.pov'. */
  field: string;
  /** The Extracted.source that produced the divergence. */
  source: string;
  /** Human-readable one-liner. */
  detail: string;
  /** The specific offending value, when the finding is value-level. */
  value?: string;
}

/** Record's closed value-set for an attribute (enum → values; controlled_vocab_csv → atomic_values). */
function recordValueSet(attr: RecordAttribute): string[] | undefined {
  return attr.values ?? attr.atomic_values;
}

/**
 * Compare the schema-of-record against ONE extracted consumer surface. Pure — same inputs, same
 * Findings; caller aggregates across surfaces. Snapshot/coverage fields are never consulted.
 */
// enum/controlled_vocab_csv are string-backed: the corpus always observes JSON runtime type
// 'string' for these fields — suppress type_mismatch when both sides resolve to string (t/3467).
const STRING_BACKED = new Set(['string', 'enum', 'controlled_vocab_csv']);

export function checkSchemaDrift(record: SchemaRecord, extracted: Extracted): Finding[] {
  const findings: Finding[] = [];
  const src = extracted.source;

  // ── graph_attributes ──
  for (const [field, ex] of Object.entries(extracted.attributes ?? {})) {
    const path = `graph_attributes.${field}`;
    const rec = record.graph_attributes[field];

    // Field the consumer has but the record does not declare at all.
    if (!rec) {
      findings.push({ type: 'extra_in_consumer', field: path, source: src, detail: `consumer surface has attribute "${field}" not present in the record` });
      continue;
    }

    // Type divergence (both sides must state a type to compare).
    if (ex.type !== undefined && rec.type !== undefined && ex.type !== rec.type) {
      if (!(STRING_BACKED.has(rec.type) && ex.type === 'string')) {
        findings.push({ type: 'type_mismatch', field: path, source: src, detail: `type ${JSON.stringify(ex.type)} in consumer vs ${JSON.stringify(rec.type)} in record` });
      }
    }

    // A DEPRECATED or REMOVED record attribute observed in use by the corpus. `removed` is the
    // tombstone status (t/3433): the field was retired from the corpus, kept in the record only so a
    // re-add is a visible diff — so a `removed` field re-appearing in the corpus is exactly the drift
    // the tombstone exists to catch, and fires the same finding (t/3463).
    if (extracted.kind === 'corpus' && (rec.status === 'deprecated' || rec.status === 'removed')) {
      findings.push({ type: 'deprecated_in_use', field: path, source: src, detail: `record marks "${field}" status:${rec.status} but it is present in the corpus` });
    }

    // Value-set divergence.
    const recVals = recordValueSet(rec);
    if (ex.values !== undefined && recVals !== undefined) {
      const recSet = new Set(recVals);
      const exSet = new Set(ex.values);
      for (const v of ex.values) {
        if (!recSet.has(v)) {
          findings.push({ type: 'extra_in_consumer', field: path, source: src, detail: `value "${v}" in consumer not declared in the record`, value: v });
        }
      }
      // "missing" is a validator concern only — a record value merely UNUSED by the corpus is not drift.
      if (extracted.kind === 'validator') {
        for (const v of recVals) {
          if (!exSet.has(v)) {
            findings.push({ type: 'missing_in_consumer', field: path, source: src, detail: `record value "${v}" not present in the consumer`, value: v });
          }
        }
      }
    }
  }

  // ── edges ──
  if (extracted.edgeTypes !== undefined) {
    const canonical = new Set(record.edges.canonical.map((e) => e.type));
    const deprecated = new Set(record.edges.deprecated_types);
    const exEdges = new Set(extracted.edgeTypes);
    for (const t of extracted.edgeTypes) {
      if (deprecated.has(t)) {
        findings.push({ type: 'deprecated_in_use', field: 'edges', source: src, detail: `deprecated edge type "${t}" in use`, value: t });
      } else if (!canonical.has(t)) {
        findings.push({ type: 'extra_in_consumer', field: 'edges', source: src, detail: `edge type "${t}" not in the canonical set`, value: t });
      }
    }
    if (extracted.kind === 'validator') {
      for (const t of canonical) {
        if (!exEdges.has(t)) {
          findings.push({ type: 'missing_in_consumer', field: 'edges', source: src, detail: `canonical edge type "${t}" not present in the consumer`, value: t });
        }
      }
    }
  }

  // ── node_id pov / category value-sets ──
  for (const key of ['pov', 'category'] as const) {
    const recVals = record.node_id?.[key];
    const exVals = extracted.nodeId?.[key];
    if (recVals === undefined || exVals === undefined) continue;
    const recSet = new Set(recVals);
    const exSet = new Set(exVals);
    for (const v of exVals) {
      if (!recSet.has(v)) findings.push({ type: 'extra_in_consumer', field: `node_id.${key}`, source: src, detail: `${key} value "${v}" in consumer not in the record`, value: v });
    }
    if (extracted.kind === 'validator') {
      for (const v of recVals) {
        if (!exSet.has(v)) findings.push({ type: 'missing_in_consumer', field: `node_id.${key}`, source: src, detail: `record ${key} value "${v}" not present in the consumer`, value: v });
      }
    }
  }

  findings.push(...checkNodeFields(record, extracted));
  return findings;
}

/**
 * node_fields (t/3955). Only fields the record LISTS are compared (the record does not yet govern every
 * top-level key, so unlisted consumer keys are deliberately not flagged; stated in node_fields._doc).
 */
function checkNodeFields(record: SchemaRecord, extracted: Extracted): Finding[] {
  const findings: Finding[] = [];
  for (const [name, rec] of Object.entries(record.node_fields ?? {})) {
    if (name.startsWith('_') || typeof rec !== 'object' || rec === null) continue;
    for (const kind of ['pov', 'situation'] as const) {
      const observed = extracted.nodeFields?.[kind];
      if (observed === undefined) continue; // this surface does not cover that node kind
      findings.push(...nodeFieldFindings({ name, rec, kind, obs: observed[name], extracted }));
    }
  }
  return findings;
}

interface NodeFieldCase {
  name: string;
  rec: RecordNodeField;
  kind: 'pov' | 'situation';
  obs: NodeFieldObservation | undefined;
  extracted: Extracted;
}

/** One recorded node field against one node kind of one surface. */
function nodeFieldFindings(c: NodeFieldCase): Finding[] {
  const applies = c.rec.applies_to === 'all' || c.rec.applies_to === c.kind;
  return applies ? appliedFieldFindings(c) : forbiddenFieldFindings(c);
}

/** The field belongs on this node kind: it must be declared, with the record's type, and not be deprecated in use. */
function appliedFieldFindings({ name, rec, kind, obs, extracted }: NodeFieldCase): Finding[] {
  const out: Finding[] = [];
  const base = { field: `node_fields.${name}`, source: extracted.source };
  const isValidator = extracted.kind === 'validator';
  if (isValidator && !obs?.accepts) {
    out.push({ ...base, type: 'missing_in_consumer', detail: `${kind} schema does not declare "${name}" (a plain z.object would strip it on parse)` });
  }
  if (obs?.type !== undefined && obs.type !== rec.type) {
    out.push({ ...base, type: 'type_mismatch', detail: `${kind} ${isValidator ? 'schema declares' : 'nodes carry'} "${name}" as ${JSON.stringify(obs.type)}, record says ${JSON.stringify(rec.type)}` });
  }
  if (!isValidator && obs && (rec.status === 'deprecated' || rec.status === 'removed')) {
    out.push({ ...base, type: 'deprecated_in_use', detail: `record marks "${name}" status:${rec.status} but ${kind} nodes carry it` });
  }
  return out;
}

/** The field does NOT belong on this node kind: it must not be accepted, and a validator must reject it explicitly. */
function forbiddenFieldFindings({ name, rec, kind, obs, extracted }: NodeFieldCase): Finding[] {
  const base = { field: `node_fields.${name}`, source: extracted.source };
  const isValidator = extracted.kind === 'validator';
  if (obs?.accepts) {
    return [{ ...base, type: 'extra_in_consumer', detail: `"${name}" applies to ${rec.applies_to} nodes only, but ${kind} ${isValidator ? 'schema accepts it' : 'nodes carry it'}` }];
  }
  if (isValidator && !obs) {
    return [{ ...base, type: 'missing_in_consumer', detail: `${kind} schema does not REJECT "${name}" (applies to ${rec.applies_to} only); an undeclared key is silently stripped, not rejected` }];
  }
  return [];
}
