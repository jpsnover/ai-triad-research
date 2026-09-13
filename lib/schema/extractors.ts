// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Consumer-surface extractors for the schema-drift gate (t/3453). Each produces the normalized
// `Extracted` shape that checkSchemaDrift() diffs against the record. NO prompt scraping (SO
// condition 3, t/3447#5) — prompts are deferred to the structured-vocab-block follow-up.
//
// SURFACE COVERAGE (see t/3453 note): two runtime-viable surfaces are implemented here —
//  - Zod: introspected via each schema's `.options` (robust; no source parsing).
//  - Live corpus: distinct values read from the POV node JSON + edges.json.
// The third named surface, TS type unions, is COMPILE-ERASED at runtime and its only enumerated
// vocab lists live in the renderer (React-coupled, cross-package) / a Python validator — neither
// lib-reachable at runtime. TS-union extraction is therefore deferred alongside prompts; the Zod
// extractor already covers the subset (node_scope, edge types) that is mirrored in Zod. Flagged on
// t/3453 for TL/Quality.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeScopeSchema, CanonicalEdgeTypeSchema } from '../debate/schemas.js';
import type { Extracted } from './checkSchemaDrift.js';

/**
 * Extract the vocab the lib Zod validators enforce (lib/debate/schemas.ts), by introspecting each
 * enum's `.options` — no source parsing. Covers node_scope + the canonical edge-type set (the record
 * vocabularies that ARE Zod-encoded today; the free-string graph_attributes are not Zod-gated).
 */
export function extractZodVocab(): Extracted {
  return {
    source: 'zod:lib/debate/schemas.ts',
    kind: 'validator',
    attributes: {
      node_scope: { type: 'enum', values: [...NodeScopeSchema.options] },
    },
    edgeTypes: [...CanonicalEdgeTypeSchema.options],
  };
}

// Graph-attributes stored as a comma-joined controlled vocab (schema type controlled_vocab_csv).
const CSV_ATTRS = new Set(['rhetorical_strategy', 'emotional_register', 'audience']);
// Single-value enum graph-attributes.
const ENUM_ATTRS = new Set(['epistemic_type', 'node_scope', 'falsifiability']);

interface CorpusNode { id?: string; graph_attributes?: Record<string, unknown> }

/** Runtime type label for a corpus value, comparable to the record's `type`. */
function typeOf(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  return typeof v; // 'string' | 'object' | 'number' | 'boolean'
}

/**
 * Extract distinct graph-attribute values + edge types actually present in the live corpus.
 * `originDir` is the taxonomy Origin directory (…/ai-triad-data/taxonomy/Origin) — passed explicitly
 * so this stays pure/testable (CI wiring resolves it via taxonomyLoader.resolveDataRoot separately).
 * Missing files are skipped (best-effort; the gate reports on what IS present).
 */
export function extractCorpusValues(originDir: string): Extracted {
  const values: Record<string, Set<string>> = {};
  const observedTypes: Record<string, Set<string>> = {};
  const addVal = (field: string, v: string) => { (values[field] ??= new Set()).add(v); };
  const addType = (field: string, t: string) => { (observedTypes[field] ??= new Set()).add(t); };

  for (const fn of ['accelerationist.json', 'safetyist.json', 'skeptic.json']) {
    let nodes: CorpusNode[];
    try {
      const raw = readFileSync(join(originDir, fn), 'utf-8').replace(/^﻿/, '');
      nodes = (JSON.parse(raw).nodes ?? []) as CorpusNode[];
    } catch { continue; } // best-effort: a missing/malformed POV file is skipped, not fatal
    for (const n of nodes) {
      const ga = n.graph_attributes;
      if (!ga) continue;
      for (const [field, v] of Object.entries(ga)) {
        if (v === undefined || v === null) continue;
        addType(field, typeOf(v));
        if (typeof v === 'string') {
          if (CSV_ATTRS.has(field)) for (const tok of v.split(',').map((s) => s.trim()).filter(Boolean)) addVal(field, tok);
          else if (ENUM_ATTRS.has(field)) addVal(field, v.trim());
        }
      }
    }
  }

  const edgeTypes = new Set<string>();
  try {
    const raw = readFileSync(join(originDir, 'edges.json'), 'utf-8').replace(/^﻿/, '');
    const ef = JSON.parse(raw);
    for (const e of (ef.edges ?? [])) if (typeof e?.type === 'string') edgeTypes.add(e.type);
    for (const et of (ef.edge_types ?? [])) if (typeof et?.type === 'string') edgeTypes.add(et.type);
  } catch { /* best-effort: no edges.json → no edge findings from this surface */ }

  const attributes: NonNullable<Extracted['attributes']> = {};
  const fields = new Set([...Object.keys(values), ...Object.keys(observedTypes)]);
  for (const field of fields) {
    const ts = observedTypes[field];
    attributes[field] = {
      ...(values[field] ? { values: [...values[field]].sort() } : {}),
      // Collapse the observed runtime types: one → that type; mixed → sorted join (never equals a
      // single record type, so a str/dict split like steelman_vulnerability fires type_mismatch).
      ...(ts && ts.size > 0 ? { type: ts.size === 1 ? [...ts][0] : [...ts].sort().join('|') } : {}),
    };
  }

  return { source: 'corpus', kind: 'corpus', attributes, edgeTypes: [...edgeTypes].sort() };
}
