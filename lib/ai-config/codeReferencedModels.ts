// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Code-referenced models (t/3553 item 1; SO e/271, TL checklist e/271#12). PURE — no IO.
//
// `codeReferencedModels.json` lists every REGISTERED model id written as a literal in code: the union of the TS
// lint's and the PS lint's resolving hits. The registry refresh pins these so it can never curate away a model
// that code still names (the refresh runs where there is no source tree, so it can't scan — it reads this list).
// Both lints assert the list is FRESH: every registered literal they find must be in it (subset, not equality —
// a stale extra only over-pins, which fails safe; extras are a non-blocking WARN).
//
// Membership is by REGISTRATION, not by marker (SO e/271#6 (c)): a registered literal is in whatever marker it
// carries; an unregistered one (e.g. `allow-external`) is out.

import { findModelLiterals, type SourceFile } from './modelLiteralLint.js';

export type CodeReferenceSource = 'ps' | 'ts';

export interface CodeReferencedModelsFile {
  /** Provenance only; never read for behavior. */
  generatedBy: string;
  /** Sorted, unique: the union of `bySource`. What the refresh pins. */
  ids: string[];
  /** Each lint's own hits, sorted and unique, so each lint can report its own stale extras. */
  bySource: Record<CodeReferenceSource, string[]>;
}

export const GENERATED_BY = 'npm run gen:code-referenced-models (lib/ai-config/genCodeReferencedModels.ts)';

/** The fix named in every freshness failure. */
export const REGENERATE_HINT = 'run `npm run gen:code-referenced-models` (requires pwsh 7) and commit lib/ai-config/codeReferencedModels.json';

/** The TS lint's resolving hits: ids found by `findModelLiterals` that are registered, whatever their marker. Unsorted. */
export function registeredLiteralIds(files: SourceFile[], validIds: ReadonlySet<string>): string[] {
  const ids = new Set<string>();
  for (const file of files) {
    for (const hit of findModelLiterals(file)) if (validIds.has(hit.id)) ids.add(hit.id);
  }
  return [...ids];
}

/** The ONE sort point (SO e/271#6): code-unit order, after de-duplication. */
const sortedUnique = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();

/** Build the file from each lint's hits. Unregistered ids are dropped, so only registered ids are ever pinned. */
export function buildCodeReferencedModels(
  tsIds: Iterable<string>,
  psIds: Iterable<string>,
  validIds: ReadonlySet<string>,
): CodeReferencedModelsFile {
  const ts = sortedUnique([...tsIds].filter((id) => validIds.has(id)));
  const ps = sortedUnique([...psIds].filter((id) => validIds.has(id)));
  return { generatedBy: GENERATED_BY, ids: sortedUnique([...ps, ...ts]), bySource: { ps, ts } };
}

/** 2-space JSON plus a trailing LF. Byte-identical for the same input, so regeneration never makes a noisy diff. */
export function serializeCodeReferencedModels(file: CodeReferencedModelsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Shape-check the committed file. Throws on anything malformed, so a broken list fails loudly rather than
 * reading as "nothing is code-referenced".
 */
export function parseCodeReferencedModels(raw: unknown): CodeReferencedModelsFile {
  const problems: string[] = [];
  const f = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const bySource = (f.bySource && typeof f.bySource === 'object' ? f.bySource : {}) as Record<string, unknown>;
  if (!isStringArray(f.ids)) problems.push('ids must be an array of strings');
  if (!isStringArray(bySource.ps)) problems.push('bySource.ps must be an array of strings');
  if (!isStringArray(bySource.ts)) problems.push('bySource.ts must be an array of strings');
  if (problems.length > 0) {
    throw new Error(`codeReferencedModels.json is malformed: ${problems.join('; ')}. Fix: ${REGENERATE_HINT}.`);
  }
  return raw as CodeReferencedModelsFile;
}

/** Hits a lint found that the list lacks: a non-empty result means the list is stale (the blocking check). */
export function missingFromList(found: Iterable<string>, file: CodeReferencedModelsFile): string[] {
  const listed = new Set(file.ids);
  return sortedUnique([...found].filter((id) => !listed.has(id)));
}

/** List entries attributed to `source` that its lint no longer finds: stale but safe (they only over-pin). WARN only. */
export function staleExtras(file: CodeReferencedModelsFile, source: CodeReferenceSource, found: Iterable<string>): string[] {
  const seen = new Set(found);
  return file.bySource[source].filter((id) => !seen.has(id));
}

/** What a `pwsh` emitter run produced. Mirrors the relevant part of `child_process.spawnSync`'s result. */
export interface EmitterRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Parse the PS emitter's stdout (`Get-CodeReferencedModels.ps1 -Scope All -Json`). FAILS CLOSED (SO e/271#15):
 * a spawn error, a non-zero exit, empty stdout, or anything but a JSON array of strings throws — it is never read
 * as "no PS literals", because that would silently un-pin every PowerShell-named model.
 */
export function parsePsEmitterOutput(run: EmitterRun): string[] {
  const where = 'scripts/Get-CodeReferencedModels.ps1 -Scope All -Json';
  const detail = run.stderr.trim() ? ` stderr: ${run.stderr.trim()}` : '';
  if (run.error) throw new Error(`could not run ${where} (requires pwsh 7 on PATH): ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${where} exited ${run.status}.${detail}`);
  const text = run.stdout.trim();
  if (text === '') throw new Error(`${where} printed nothing; expected a JSON array ([] when there are no ids).${detail}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${where} printed non-JSON output: ${text.slice(0, 200)}`);
  }
  if (!isStringArray(parsed)) {
    throw new Error(`${where} must print a JSON array of strings, got ${JSON.stringify(parsed)?.slice(0, 200)} (use ConvertTo-Json -AsArray).`);
  }
  return parsed;
}
