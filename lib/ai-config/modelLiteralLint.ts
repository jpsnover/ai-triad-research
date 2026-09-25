// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Model-literal lint for production TypeScript (t/3559 Gap B of t/3557; t/3657 conditions 1-3) — the TS
// sibling of tests/ModelLiteralLint.Tests.ps1 (t/1858). Same predicate, same marker grammar, same guards.
// The shared conformance corpus (modelLiteralLint.conformance.json, t/3656) forces the two to agree.
//
// PREDICATE: every model-ID literal in production TS must RESOLVE to a real `models[].id` in
// ai-models.json, OR carry a co-located, TYPED `model-lint:allow-<kind> <reason>` marker on the same
// physical line. This is resolve-or-exempt — NOT "no hardcoded IDs" (that would break load-bearing pins
// like PINNED_EVALUATOR_MODEL, whose stability is what makes calibration scores comparable over time).
//
// MARKER GRAMMAR (t/3657 condition 1 — split from the old ambiguous bare `model-lint:allow`):
//   model-lint:allow-<kind> <reason>   where <kind> ∈ pin | external | nonselect, <reason> mandatory.
//   - pin        — a deliberately hardcoded selection, absence from the registry is by design.
//   - external   — a real selection governed by a DIFFERENT registry (e.g. an embedding model).
//   - nonselect  — a model-id-shaped literal that is NOT a runtime selection (display maps,
//                  normalization tables). Reason MUST name the actual use, not assert the negative
//                  (t/3657#5) — it is the most abusable kind and is ratcheted separately.
//   The bare form (no kind) and a kind with no reason are BOTH invalid → offender. The ambiguous bare
//   marker let a retired-model id hide behind a true-sounding reason for months (t/3657#7) — the concrete
//   defect condition 1 exists to close.
//   CONTRADICTION: a VALID marker on an id that RESOLVES to the registry is an offender for every kind —
//   the id is registered, so the exemption is spurious (it was never unregistered).
//
// AUTHORITY CONSISTENCY (TL t/3559): the valid-id set is ai-models.json `models[].id`. The PowerShell lint
// resolves against `$script:ValidModelIds`, an unfiltered projection of the same field of the same file
// (AITriad.psm1:642), so the two gates resolve against the identical set by construction.
//
// Pure over a provided file set — IO (glob + read) is the caller's (the test). Fixture-testable.

/** The marker prefix — the SAME string family as the PS lint. Kept for offender-message construction. */
export const SUPPRESS_MARKER = 'model-lint:allow';

/** The three exemption kinds (t/3657 condition 1). Order is stable for per-kind ratchet baselines. */
export const MARKER_KINDS = ['pin', 'external', 'nonselect'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

/** Result of parsing a co-located marker on a physical line. */
export type MarkerParse =
  | { kind: MarkerKind; reason: string } // a valid, typed, reasoned marker
  | { invalid: 'bare' | 'no-reason' } // present but malformed → cannot exempt
  | null; // no marker on the line

// A model-ID-shaped quoted literal: a known backend prefix, then `-`, then a run of [a-z0-9.-] that
// ENDS alphanumeric (so a regex fragment like 'claude-3.5-' — trailing dash — does NOT match).
// LOWERCASE-ONLY (no `i` flag): registry ids are lowercase, so this drops prose like "GPT-4o". The
// version-digit requirement (enforced below) drops key-prefix strings like 'gemini-key'.
const BACKEND_PREFIX = '(?:claude|gemini|gpt|o[1-4]|groq|deepseek|ollama|moonshot|xai|zai)';
const MODEL_LITERAL_RE = new RegExp(`['"\`](${BACKEND_PREFIX}-[a-z0-9.-]*[a-z0-9])['"\`]`, 'g');

// Dated wire apiModelId (e.g. `claude-opus-5-20260115`): a trailing -YYYYMMDD. Provider wire ids used by
// the discovery PROBE path and dated JSDoc examples — never a `models[].id` *selection*. Excluded so the
// discovery mechanism's enumerations stay out WITHOUT a file-path exclusion.
const DATED_APIMODELID_RE = /-\d{8}$/;

// Typed marker: `model-lint:allow` then an OPTIONAL `-<kind>` then an OPTIONAL ` <reason>`. Operates on a
// SINGLE physical line (the caller splits on /\r?\n/, so no trailing \r is swallowed into <reason> — the
// PS side reads via ReadAllLines for the same parity, t/3657#3 note A). Group 1 = kind, group 2 = reason.
const MARKER_RE = new RegExp(`${SUPPRESS_MARKER}(?:-(pin|external|nonselect))?(?:\\s+(\\S.*))?$`);

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
  /** The co-located marker parsed from the same physical line. */
  marker: MarkerParse;
}

export interface LintOffender extends LiteralHit {
  /** Why this hit is an offender — the discriminated failure mode. */
  kind: 'unregistered' | 'bare-marker' | 'no-reason-marker' | 'contradiction';
  /** Actionable one-liner. */
  message: string;
}

/**
 * Parse a co-located `model-lint:allow[-kind] [reason]` marker from one physical line.
 * Returns a valid {@link MarkerParse}, an `{invalid}` verdict for the malformed forms, or `null` when
 * the line carries no marker at all.
 */
export function parseMarker(line: string): MarkerParse {
  const m = line.match(MARKER_RE);
  if (!m) return null;
  const kind = m[1] as MarkerKind | undefined;
  const reason = m[2]?.trim();
  if (!kind) return { invalid: 'bare' }; // the deprecated ambiguous form — must not survive
  if (!reason) return { invalid: 'no-reason' }; // a kind with no justification
  return { kind, reason };
}

/**
 * Extract candidate model-ID literals from a file, each paired with its line's co-located marker.
 * A candidate is a quoted, lowercase, backend-prefixed, version-digit-bearing, alphanumeric-terminated
 * token that is NOT a dated wire apiModelId. Unlike the pre-t/3657 lint, marked lines are NOT skipped —
 * the marker is parsed and attached so {@link lintModelLiterals} can apply the typed-marker semantics.
 */
export function findModelLiterals(file: SourceFile): LiteralHit[] {
  const hits: LiteralHit[] = [];
  const lines = file.content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = parseMarker(line);
    for (const m of line.matchAll(MODEL_LITERAL_RE)) {
      const id = m[1];
      if (!/[0-9]/.test(id)) continue; // no version digit → not a model id (drops 'gemini-key')
      if (DATED_APIMODELID_RE.test(id)) continue; // dated wire apiModelId, not a models[].id selection
      hits.push({ path: file.path, line: i + 1, id, marker });
    }
  }
  return hits;
}

function remedy(id: string): string {
  return (
    `Fix one of: register '${id}' in ai-models.json, repoint to a valid id, or append a co-located ` +
    `"${SUPPRESS_MARKER}-<pin|external|nonselect> <reason>" marker on that line (reason mandatory; ` +
    `nonselect must name the actual non-selection use).`
  );
}

/** The per-literal verdict. `ok`/`exempt` are clean; the rest are offender kinds. */
export type LiteralVerdict = 'ok' | 'exempt' | LintOffender['kind'];

/**
 * The SINGLE source of truth for the resolve-or-exempt predicate, over an ALREADY-EXTRACTED id + its
 * parsed marker. Decoupled from extraction on purpose — extraction differs between the TS and PS gates
 * by design (t/3560), so the shared conformance corpus (t/3656) exercises exactly this function, not the
 * extraction regex. `lintModelLiterals` and `countExemptionsByKind` both delegate here so the verdict
 * logic exists in one place and cannot drift between the real-tree lint and the corpus test.
 *
 *  - no marker      → registered ? 'ok' : 'unregistered'
 *  - invalid marker → 'bare-marker' | 'no-reason-marker'   [the ambiguous / unjustified forms]
 *  - valid marker   → registered ? 'contradiction' : 'exempt'   [spurious exemption on a real id]
 */
export function classifyLiteral(
  id: string,
  marker: MarkerParse,
  validIds: ReadonlySet<string>,
): LiteralVerdict {
  if (marker === null) return validIds.has(id) ? 'ok' : 'unregistered';
  if ('invalid' in marker) return marker.invalid === 'bare' ? 'bare-marker' : 'no-reason-marker';
  return validIds.has(id) ? 'contradiction' : 'exempt';
}

function offenderMessage(verdict: LintOffender['kind'], id: string, at: string, markerKind?: MarkerKind): string {
  switch (verdict) {
    case 'unregistered':
      return `${at} names model id '${id}' which resolves to no ai-models.json entry. ${remedy(id)}`;
    case 'bare-marker':
      return `${at} carries a bare "${SUPPRESS_MARKER}" marker on '${id}'. The bare form is ambiguous and rejected (t/3657 condition 1) — a retired id can hide behind it. Use "${SUPPRESS_MARKER}-<pin|external|nonselect> <reason>".`;
    case 'no-reason-marker':
      return `${at} carries a "${SUPPRESS_MARKER}" marker on '${id}' with a kind but no reason. Reason is mandatory. ${remedy(id)}`;
    case 'contradiction':
      return `${at} exempts '${id}' with "${SUPPRESS_MARKER}-${markerKind}", but that id IS registered in ai-models.json — the marker is spurious. Remove it; the literal resolves on its own.`;
  }
}

/**
 * The lint: every model-ID literal in `files` must resolve to `validIds` or carry a VALID typed marker
 * exempting it. Returns the offenders (empty = clean). Pure — the test supplies the files and the id set.
 * Delegates the per-literal verdict to {@link classifyLiteral}.
 */
export function lintModelLiterals(files: SourceFile[], validIds: ReadonlySet<string>): LintOffender[] {
  const offenders: LintOffender[] = [];
  for (const file of files) {
    for (const hit of findModelLiterals(file)) {
      const verdict = classifyLiteral(hit.id, hit.marker, validIds);
      if (verdict === 'ok' || verdict === 'exempt') continue;
      const markerKind = hit.marker && !('invalid' in hit.marker) ? hit.marker.kind : undefined;
      offenders.push({
        ...hit,
        kind: verdict,
        message: offenderMessage(verdict, hit.id, `${hit.path}:${hit.line}`, markerKind),
      });
    }
  }
  return offenders;
}

/**
 * Count ACTIVE exemptions (valid markers on genuinely-unregistered ids) per kind, for the condition-2
 * ratchet. Contradictions (valid marker on a registered id) are offenders, not exemptions, so they are
 * NOT counted. `nonselect` is tracked separately because a rising `nonselect` count signals the
 * EXTRACTION is over-broad, not that more exemptions are warranted (t/3657#5 constraint 2).
 */
export function countExemptionsByKind(
  files: SourceFile[],
  validIds: ReadonlySet<string>,
): Record<MarkerKind, number> {
  const counts: Record<MarkerKind, number> = { pin: 0, external: 0, nonselect: 0 };
  for (const file of files) {
    for (const hit of findModelLiterals(file)) {
      if (classifyLiteral(hit.id, hit.marker, validIds) === 'exempt' && hit.marker && !('invalid' in hit.marker)) {
        counts[hit.marker.kind] += 1;
      }
    }
  }
  return counts;
}

/**
 * Condition 3 — registry-unreadable/empty must be a DISTINCT outcome, never "unregistered literal."
 * Fail-closed means a malformed ai-models.json would otherwise flag every literal as unregistered and
 * block every merge repo-wide from an INFRA condition, misattributed to a code defect. The caller invokes
 * this on the loaded id set before linting; an empty set means the registry failed to load or is empty.
 * Throws a plain Error whose message discriminates the cause (the TS test asserts the wording; the PS
 * side raises the parallel loader-level ActionableError with the same discriminating text, t/3657#3).
 */
export function assertModelRegistryUsable(validIds: ReadonlySet<string>): void {
  if (validIds.size > 0) return;
  throw new Error(
    'model-literal lint: ai-models.json is unreadable or empty — this is an INFRASTRUCTURE condition, ' +
      'not an unregistered literal. Do not hunt for a bad model id; restore/repair the registry file. ' +
      '(Fail-closed: an empty id set would otherwise flag every literal as unregistered.)',
  );
}
