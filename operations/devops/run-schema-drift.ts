// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// CI runner for the schema drift gate (t/3469, t/3447 Phase-1).
// Warn-only: always exits 0. Findings are emitted as ::warning:: GitHub annotations.
// Promotion to blocking is a separate deliberate PR (t/3447 Phase-2, TL Gate-Verification required).
//
// Surfaces checked:
//   1. Zod validators — lib/debate/schemas.ts (NodeScopeSchema, CanonicalEdgeTypeSchema)
//   2. Corpus         — ai-triad-data/taxonomy/Origin (if data repo present)
//   3. Prompt-writer guard (t/3550) — registered controlled-vocab writers must keep a fence, and no
//      un-registered prompt may emit vocab values without one (the silent-new-writer gap).
//
// No PS logic twin (SO cond 2, t/3447#5): this is the one canonical JS comparator entry point.

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { checkSchemaDrift, type SchemaRecord } from '../../lib/schema/checkSchemaDrift.js';
import { extractZodVocab, extractCorpusValues } from '../../lib/schema/extractors.js';
import { runPromptWriterGuard, collectPromptFiles } from '../../lib/schema/promptWriterGuard.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const schemaPath = join(repoRoot, 'lib/schema/taxonomy-schema.json');
const record = JSON.parse(readFileSync(schemaPath, 'utf-8')) as SchemaRecord;

const surfaces = [extractZodVocab()];

// Corpus surface: available when the data repo is present (CI sets AI_TRIAD_DATA_ROOT).
const dataRoot = process.env['AI_TRIAD_DATA_ROOT'] ?? join(repoRoot, '../ai-triad-data');
const originDir = join(dataRoot, 'taxonomy/Origin');
try {
  surfaces.push(extractCorpusValues(originDir));
} catch {
  console.log('::notice::schema-drift: data repo not available — skipping corpus surface');
}

let total = 0;
for (const extracted of surfaces) {
  const findings = checkSchemaDrift(record, extracted);
  for (const f of findings) {
    console.log(`::warning::schema-drift [${f.source}] ${f.type} @ ${f.field}: ${f.detail}`);
    total++;
  }
}

// Surface 3 — prompt-writer guard (t/3550). Scans the local prompt files (no data repo needed); a
// registered writer that lost its fence, or an un-registered prompt that emits vocab without one, is
// a warn-only finding — same phase discipline as the surface findings above.
for (const f of runPromptWriterGuard(collectPromptFiles(repoRoot), record)) {
  console.log(`::warning::schema-drift [prompt-writer-guard] ${f.type} @ ${f.path}: ${f.detail}`);
  total++;
}

if (total === 0) {
  console.log('schema-drift: 0 findings — all checked surfaces match the record.');
} else {
  console.log(`schema-drift: ${total} finding(s) — warn-only (t/3469 Phase-1). Promote to blocking requires TL Gate-Verification (t/3447 Phase-2).`);
}

// Always exit 0: warn-only until the Phase-2 blocking flip.
process.exit(0);
