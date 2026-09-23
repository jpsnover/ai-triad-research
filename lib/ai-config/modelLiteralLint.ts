// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Model-literal lint for production TypeScript (t/3559, Gap B of t/3557) — the TS sibling of
// tests/ModelLiteralLint.Tests.ps1 (t/1858). Same predicate, same suppression marker, same guards.
//
// PREDICATE: every model-ID literal in production TS must RESOLVE to a real `models[].id` in
// ai-models.json, OR carry a co-located `model-lint:allow` marker on the same physical line. This is
// resolve-or-exempt — NOT "no hardcoded IDs" (that would break load-bearing pins like
// PINNED_EVALUATOR_MODEL, whose stability is what makes calibration scores comparable over time).
//
// AUTHORITY CONSISTENCY (TL t/3559, verified t/3559#2): the valid-id set is ai-models.json
// `models[].id`. The PowerShell lint resolves against `$script:ValidModelIds`, which AITriad.psm1:642
// builds as `@($config.models | %{ $_.id })` — an UNFILTERED projection of the same field of the same
// file. So the two gates resolve against the identical set by construction; if a filter is ever added
// at AITriad.psm1:642, THAT is the line that breaks this equivalence.
//
// Pure over a provided file set — IO (glob + read) is the caller's (the test). Fixture-testable.

/** Suppression marker — the SAME string as the PS lint (tests/ModelLiteralLint.Tests.ps1), so there is
 *  one exemption convention across both surfaces. Co-located on the literal's physical line. */
export const SUPPRESS_MARKER = 'model-lint:allow';

// A model-ID-shaped quoted literal: a known backend prefix, then `-`, then a run of [a-z0-9.-] that
// ENDS alphanumeric (so a regex fragment like 'claude-3.5-' — trailing dash — does NOT match).
// LOWERCASE-ONLY (no `i` flag): registry ids are lowercase, so this drops prose like "GPT-4o" that
// appears in comments/entity-normalization tables (t/3559#3 refinement d). The version-digit
// requirement (enforced below) drops key-prefix strings like 'gemini-key'.
const BACKEND_PREFIX = '(?:claude|gemini|gpt|o[1-4]|groq|deepseek|ollama|moonshot|xai|zai)';
const MODEL_LITERAL_RE = new RegExp(`['"\`](${BACKEND_PREFIX}-[a-z0-9.-]*[a-z0-9])['"\`]`, 'g');

// Dated wire apiModelId (e.g. `claude-opus-5-20260115`): a trailing -YYYYMMDD. These are provider
// wire ids used by the discovery PROBE path (modelDiscovery.ts) and dated JSDoc examples — never a
// `models[].id` *selection*, and a retired probe target self-corrects (404 → skip). Excluding them
// (t/3559#3 refinement c) keeps the discovery mechanism's enumerations out WITHOUT a file-path
// exclusion, so a NON-dated friendly-id selection anywhere (incl. modelDiscovery.ts) is still caught.
const DATED_APIMODELID_RE = /-\d{8}$/;

export interface SourceFile {
  /** Repo-relative POSIX path (for report messages). */
  path: string;
  /** Raw file text. */
  content: string;
}

export interface LiteralHit {
  path: string;
  line: number; // 1-indexed
  id: string;
}

export interface LintOffender extends LiteralHit {
  /** Actionable one-liner: file:line, offending id, and the three remedies. */
  message: string;
}

/**
 * Extract candidate model-ID literals from a file. A candidate is a quoted, lowercase,
 * backend-prefixed, version-digit-bearing, alphanumeric-terminated token that is NOT a dated wire
 * apiModelId. Lines carrying the {@link SUPPRESS_MARKER} are skipped entirely (co-located exemption).
 * Returns every hit; registry resolution is the caller's job ({@link lintModelLiterals}).
 */
export function findModelLiterals(file: SourceFile): LiteralHit[] {
  const hits: LiteralHit[] = [];
  const lines = file.content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(SUPPRESS_MARKER)) continue; // co-located suppression
    for (const m of line.matchAll(MODEL_LITERAL_RE)) {
      const id = m[1];
      if (!/[0-9]/.test(id)) continue; // no version digit → not a model id (drops 'gemini-key')
      if (DATED_APIMODELID_RE.test(id)) continue; // dated wire apiModelId, not a models[].id selection
      hits.push({ path: file.path, line: i + 1, id });
    }
  }
  return hits;
}

/**
 * The lint: every model-ID literal in `files` must resolve to `validIds` or carry the co-located
 * marker (already filtered by {@link findModelLiterals}). Returns the offenders (empty = clean).
 * Pure — the test supplies the scanned files and the id set.
 */
export function lintModelLiterals(files: SourceFile[], validIds: ReadonlySet<string>): LintOffender[] {
  const offenders: LintOffender[] = [];
  for (const file of files) {
    for (const hit of findModelLiterals(file)) {
      if (validIds.has(hit.id)) continue; // resolves to a registered model
      offenders.push({
        ...hit,
        message:
          `${hit.path}:${hit.line} names model id '${hit.id}' which resolves to no ai-models.json entry. ` +
          `Fix one of: register it in ai-models.json, repoint to a valid id, or (if the pin is deliberate) ` +
          `append a "${SUPPRESS_MARKER}" marker comment on that line with the reason.`,
      });
    }
  }
  return offenders;
}
