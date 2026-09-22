// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Prompt-writer guard (t/3550) — closes the "silent new-writer" gap in the schema-drift path.
//
// The drift gate compares prompts that ALREADY carry a `### CONTROLLED VOCABULARY … ###` fence
// (extractPromptVocab). A NEW prompt that EMITS controlled-vocab values into graph_attributes WITHOUT
// a fence is invisible to the extractor — nothing to parse, so no drift is reported. The manual
// per-session diff-scan (t/3455) was the only thing catching that. This makes it a check.
//
// Two obligations, both WARN-only in the schema-drift gate (promotion to blocking is a separate
// TL-Gate-Verification + Second-Opinion PR — root AGENTS.md, t/3447 Phase-2):
//   (a) every REGISTERED writer must carry a current, record-matching fence;
//   (b) no UN-registered prompt may look like a writer without a fence.
//
// Pure over the provided file set — IO (glob + readFile) belongs to the caller/runner, so this stays
// unit-testable with in-memory fixtures.
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { extractPromptVocab, hasVocabFence } from './extractors.js';
import { checkSchemaDrift, type SchemaRecord } from './checkSchemaDrift.js';

/**
 * The controlled-vocab graph_attributes a prompt can "write" — DERIVED from the record (SSOT), so
 * the field list can't drift from taxonomy-schema.json. These are the `enum` / `controlled_vocab_csv`
 * attributes (today: epistemic_type, node_scope, falsifiability, rhetorical_strategy,
 * emotional_register, audience).
 */
export function controlledVocabFields(record: SchemaRecord): string[] {
  return Object.entries(record.graph_attributes)
    .filter(([, a]) => a.type === 'enum' || a.type === 'controlled_vocab_csv')
    .map(([field]) => field);
}

/**
 * SSOT: prompt files that emit controlled-vocab values into graph_attributes (CL co-signed, t/3550#1).
 * Repo-relative POSIX paths. A registered writer MUST carry a fence; adding a new writer means adding a
 * fence AND an entry here — the guard fails-forward if either is missing.
 */
export const WRITER_REGISTRY: readonly string[] = [
  'taxonomy-editor/src/renderer/prompts/analysis.ts',
  'scripts/AITriad/Prompts/attribute-extraction.prompt',
  'scripts/AITriad/Prompts/attribute-vocabulary.fragment.prompt',
];

/**
 * COMPANION-EXEMPT (the 3rd class beside writer/reader — CL ruling t/3550#4). A companion carries
 * controlled-vocab example values (so it trips the writer heuristic) but is NOT the vocab authority:
 * it is the output-SHAPE partner always sent WITH a fenced writer, and that fenced sibling is the
 * enum SSOT. Fencing a companion too would DUPLICATE the enum and open a new drift surface — the exact
 * opposite of this gate's purpose. So a companion is exempted, not registered.
 *   - attribute-extraction-schema.prompt: output-shape companion always paired with the fenced
 *     attribute-extraction.prompt (Invoke-AttributeExtraction.ps1:112-113); its example values are all
 *     canonical (no misleading). CL co-signed the exemption (t/3550#4).
 */
export const COMPANION_EXEMPT: readonly string[] = [
  'scripts/AITriad/Prompts/attribute-extraction-schema.prompt',
];

export interface PromptFile {
  /** Repo-relative POSIX path (matched against WRITER_REGISTRY). */
  path: string;
  /** Raw file text (template source for .ts, raw prompt for .prompt). */
  content: string;
}

export type PromptClass = 'writer-fenced' | 'writer-unfenced' | 'non-writer';

/**
 * A prompt COMPOSES a registered vocab fragment (e.g. `{{attribute-vocabulary}}`) → it inherits that
 * fragment's fence and is fence-equivalent. Include-tokens are DERIVED from the registered
 * `*.fragment.prompt` writers, so registering a new fragment automatically extends this.
 */
function includesVocabFragment(content: string, registry: readonly string[]): boolean {
  for (const p of registry) {
    const m = /([^/]+)\.fragment\.prompt$/.exec(p);
    if (m && content.includes(`{{${m[1]}}}`)) return true;
  }
  return false;
}

/**
 * EMIT-signal: the prompt instructs EMITTING controlled-vocab values (vs a READER that names the
 * fields as input context — e.g. hierarchy-proposal "nodes sharing the same epistemic_type", debate
 * opening.ts). Two structural tells, both stronger than a generic "return JSON" cue that any output
 * prompt carries: it targets the `graph_attributes` container, or it shows a vocab field as an output
 * JSON key (`"epistemic_type": …`). A reader mentions the field in prose and does neither.
 */
function hasEmitSignal(content: string, fields: string[]): boolean {
  if (/\bgraph_attributes\b/.test(content)) return true;
  return fields.some((f) => new RegExp(`"${f}"\\s*:`).test(content));
}

/** Classify one prompt file. `matchedFields` is the subset of controlled-vocab fields it references. */
export function classifyPrompt(
  file: PromptFile,
  fields: string[],
  registry: readonly string[] = WRITER_REGISTRY,
): { cls: PromptClass; matchedFields: string[] } {
  const matchedFields = fields.filter((f) => new RegExp(`\\b${f}\\b`).test(file.content));
  // Fence-equivalent: a literal fence, or composing a registered fenced fragment.
  if (hasVocabFence(file.content) || includesVocabFragment(file.content, registry)) {
    return { cls: 'writer-fenced', matchedFields };
  }
  // No fence: a writer names ≥2 vocab fields AND carries an emit-signal. Readers name fields but
  // don't emit them, so they classify 'non-writer' → no false positive (AC3).
  if (matchedFields.length >= 2 && hasEmitSignal(file.content, fields)) {
    return { cls: 'writer-unfenced', matchedFields };
  }
  return { cls: 'non-writer', matchedFields };
}

export type GuardFindingType =
  | 'registered_writer_missing'     // a registered writer wasn't in the scanned set
  | 'registered_writer_no_fence'    // a registered writer lost its fence
  | 'registered_writer_fence_drift' // a registered writer's fence carries a value the record rejects
  | 'unregistered_writer';          // an un-registered file emits vocab values with no fence (the gap)

export interface GuardFinding {
  type: GuardFindingType;
  /** Repo-relative path of the offending prompt. */
  path: string;
  /** Human-readable one-liner (goes into the ::warning:: annotation). */
  detail: string;
  /** The offending / referenced field or value name(s), when applicable. */
  fields?: string[];
}

/**
 * Run the prompt-writer guard over a scanned prompt set. Pure; returns findings (warn-only — the
 * runner emits ::warning:: and never fails the build).
 *
 * (a) Registered writers: must be present, carry a fence, and the fence must not declare a value the
 *     record rejects (extra_in_consumer) or a retired one (deprecated_in_use). A fence listing a
 *     record-subset is NOT flagged — a prompt may legitimately scope to fewer values.
 * (b) Every non-registered `writer-unfenced` file is a finding — the silent-new-writer gap.
 */
export function runPromptWriterGuard(files: PromptFile[], record: SchemaRecord): GuardFinding[] {
  const fields = controlledVocabFields(record);
  const registry = new Set(WRITER_REGISTRY);
  const exempt = new Set(COMPANION_EXEMPT);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const findings: GuardFinding[] = [];

  // (a) Registered writers must carry a current, record-matching fence.
  for (const path of WRITER_REGISTRY) {
    const file = byPath.get(path);
    if (!file) {
      findings.push({ type: 'registered_writer_missing', path, detail: `registered writer "${path}" was not found in the scanned prompt set` });
      continue;
    }
    if (!hasVocabFence(file.content)) {
      findings.push({ type: 'registered_writer_no_fence', path, detail: `registered writer "${path}" no longer carries a CONTROLLED VOCABULARY fence` });
      continue;
    }
    // Fence present → a value it declares that the record rejects/retired is stale drift.
    const extracted = extractPromptVocab(file.content, `prompt:${path}`);
    for (const d of checkSchemaDrift(record, extracted)) {
      if (d.type === 'extra_in_consumer' || d.type === 'deprecated_in_use') {
        findings.push({ type: 'registered_writer_fence_drift', path, detail: `fence ${d.type} at ${d.field}: ${d.detail}`, fields: d.value ? [d.value] : undefined });
      }
    }
  }

  // (b) Un-registered writer-looking files with no fence — the gap this guard closes.
  for (const file of files) {
    if (registry.has(file.path) || exempt.has(file.path)) continue; // registered writer or documented companion
    const { cls, matchedFields } = classifyPrompt(file, fields);
    if (cls === 'writer-unfenced') {
      findings.push({
        type: 'unregistered_writer',
        path: file.path,
        detail: `prompt emits controlled-vocab values (${matchedFields.join(', ')}) with NO CONTROLLED VOCABULARY fence — add a fence and register it in WRITER_REGISTRY (t/3550)`,
        fields: matchedFields,
      });
    }
  }

  return findings;
}

/** Prompt-file globs the guard scans: repo-relative dir + extension. Renderer prompt templates (.ts)
 *  and the PS prompt/fragment files (.prompt). Test files are excluded. */
const PROMPT_SCAN: readonly { dir: string; ext: string }[] = [
  { dir: 'taxonomy-editor/src/renderer/prompts', ext: '.ts' },
  { dir: 'scripts/AITriad/Prompts', ext: '.prompt' },
];

/**
 * IO wrapper: recursively read the prompt files under `repoRoot` for the guard (the CI runner calls
 * `runPromptWriterGuard(collectPromptFiles(repoRoot), record)`). Kept out of the pure core so the
 * classification/guard logic stays fixture-testable. Missing dirs are skipped (best-effort).
 */
export function collectPromptFiles(repoRoot: string): PromptFile[] {
  const out: PromptFile[] = [];
  const walk = (absDir: string, ext: string): void => {
    let entries: Dirent<string>[];
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; } // dir absent → skip
    for (const e of entries) {
      const abs = join(absDir, e.name);
      if (e.isDirectory()) { walk(abs, ext); continue; }
      if (!e.name.endsWith(ext) || /\.(test|spec)\.ts$/.test(e.name)) continue;
      out.push({ path: relative(repoRoot, abs).split(sep).join('/'), content: readFileSync(abs, 'utf-8') });
    }
  };
  for (const { dir, ext } of PROMPT_SCAN) walk(join(repoRoot, dir), ext);
  return out;
}
