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
  status?: 'active' | 'deprecated' | 'transient';
}
export interface SchemaRecord {
  graph_attributes: Record<string, RecordAttribute>;
  edges: { canonical: { type: string }[]; deprecated_types: string[] };
  node_id?: { pov?: string[]; category?: string[] };
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
      findings.push({ type: 'type_mismatch', field: path, source: src, detail: `type ${JSON.stringify(ex.type)} in consumer vs ${JSON.stringify(rec.type)} in record` });
    }

    // A DEPRECATED record attribute observed in use by the corpus.
    if (extracted.kind === 'corpus' && rec.status === 'deprecated') {
      findings.push({ type: 'deprecated_in_use', field: path, source: src, detail: `record marks "${field}" status:deprecated but it is present in the corpus` });
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

  return findings;
}
