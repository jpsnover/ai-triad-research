// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Write-side rationale re-merge for the edges.json whole-file save path (t/2957, part of the
// t/2945 edge-rationale data-loss incident). The taxonomy editor loads the edge list through a
// path that strips `rationale` (payload trim, ~37% smaller), then saves the WHOLE file back —
// persisting the stripped set and wiping the on-disk rationale. This util re-merges `rationale`
// (and `rationale_source`, which move together per t/2943) from the on-disk baseline by composite
// key BEFORE the save, so a payload that originated from the stripped list endpoint never
// persists the strip. Pure: no fs, no I/O — the two save call-sites read the baseline and pass it
// in. TL-approved design t/2957#5, with the #6 required changes folded in.
//
// BASELINE = ON-DISK, deliberately NOT committed git-HEAD (TL t/2957#6 change 2; CL Issue 2).
// The fix's job is "never wipe what's on disk." Recovering rationale that was ALREADY lost from
// the working tree (a poisoned/degraded on-disk file) is the RESTORE's job (t/2946, in flight
// against ba3128f5), not this util's — so there is intentionally no git-HEAD fallback here (it
// would be transitional dead-code once the restore lands and blur the fix/restore split).
// Consequence recorded on t/2957: this util cannot recover rationale already missing from the
// on-disk file; an on-disk baseline only guarantees no NEW loss.
//
// READ-FAILURE IS NOT ABSENCE (TL #6 change 1 [BLOCKER]; CL Issue 1). `readEdgesFile()` returns
// `null` for both a missing file and a read/parse failure. Treating a read *failure* as "no
// baseline, write as-is" would make this fix fail-open into the exact wipe it prevents. So the
// baseline is a DISCRIMINATED input: pass the literal `'absent'` ONLY for a genuine first write
// (file truly absent); on a read/parse failure the CALLER must throw and never call this — and a
// malformed baseline object handed here throws rather than silently writing a stripped payload.
//
// Twin-aware identity (correctness, not a nicety — TL e/120#37; CL spec): the live file has 3
// composite keys carrying 2 genuinely distinct edges each. Primary key source|type|target; on a
// non-unique key, tie-break on discovered_at + model; still ambiguous → refuse-and-log, never guess.

import { ActionableError } from '../debate/errors.js';

/** The edges.json shape: an `edges` array of arbitrary-field edge objects, plus top-level keys. */
export type EdgesData = { edges: Record<string, unknown>[];[k: string]: unknown };

/** Sentinel for a genuine first write (edges.json truly absent) — distinct from a read failure. */
export const ABSENT_BASELINE = 'absent' as const;

/** Structured warning sink (optional). Lets the pure util surface the silent-loss case (CL Issue 4)
 *  without depending on a flight recorder — the call-site passes a recorder-backed callback. */
export type EdgeMergeWarn = (event: { message: string; data: Record<string, unknown> }) => void;

type Edge = Record<string, unknown>;

const keyOf = (e: Edge): string => `${String(e.source)}|${String(e.type)}|${String(e.target)}`;

/** Non-empty rationale predicate (TL #6 change 3; CL Issue 3). Must match Arm 1 (PS) + the Arm-2
 *  constraint (t/2958#2): `undefined | null | '' | whitespace-only` all count as ABSENT (eligible
 *  for re-merge), so a cleared/empty payload can't read as "already has one" and silently wipe. */
const hasRationale = (e: Edge): boolean => typeof e.rationale === 'string' && e.rationale.trim().length > 0;

/**
 * Restore `rationale` (+ `rationale_source`) from a baseline edge onto an incoming edge that lost
 * it on the strip-on-load round-trip, KEEPING the field in its original baseline slot (t/2949 slot
 * fix — never append) and preserving absent-ness (TL #6: if the baseline has no `rationale_source`,
 * leave it absent — never coerce to null; CL Q2: copy verbatim, never synthesize). Non-rationale
 * field VALUES come from `incoming` (an intentional editor edit to e.g. `status` is honoured); their
 * ORDER follows the baseline so a preserved edge is byte-stable vs the baseline.
 */
function restoreFrom(incoming: Edge, base: Edge): Edge {
  const out: Edge = {};
  for (const [k, baseVal] of Object.entries(base)) {
    if (k === 'rationale' || k === 'rationale_source') out[k] = baseVal; // sourced only from baseline, verbatim
    else if (k in incoming) out[k] = incoming[k];                        // editor-owned value wins
    // A baseline-only non-rationale key absent from incoming = an editor deletion → respect it (drop).
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (k === 'rationale' || k === 'rationale_source') continue; // never reintroduced from a stale payload
    if (!(k in out)) out[k] = v;                                 // preserve editor-added keys
  }
  return out;
}

/**
 * Merge `incoming` (the save payload) against the on-disk `baseline`, restoring rationale that the
 * strip-on-load round-trip dropped. Incoming edges that already carry a non-empty rationale are left
 * untouched (an intentional edit is never clobbered). New edges (no baseline key) and deleted edges
 * (absent from incoming) are natural no-ops. Returns a new EdgesData; edge order and every
 * non-rationale field are otherwise unchanged (serializer contract intact).
 *
 * @param baseline the parsed on-disk edges.json, or `ABSENT_BASELINE` for a genuine first write.
 *   A read/parse FAILURE must NOT be passed as `ABSENT_BASELINE` — throw at the call site instead.
 * @param onWarn optional sink for the "baseline has rationale for this key but no twin matched the
 *   incoming edge" case — a real rationale is not written; logged so a systematic tie-break
 *   mismatch is discoverable without a forensic reconstruction (CL Issue 4). Does not throw.
 * @throws ActionableError when the baseline is a malformed object (read failure — refuses rather
 *   than writing a stripped payload against an unreadable baseline), or when a non-unique key stays
 *   ambiguous after the discovered_at+model tie-break — never guesses.
 */
export function mergeEdgesPreservingRationale(
  incoming: EdgesData,
  baseline: EdgesData | typeof ABSENT_BASELINE,
  onWarn?: EdgeMergeWarn,
): EdgesData {
  if (!incoming || !Array.isArray(incoming.edges)) return incoming; // caller validated the payload shape
  if (baseline === ABSENT_BASELINE) return incoming;               // genuine first write — nothing to restore

  // BLOCKER guard: a baseline that is not a readable EdgesData is a read/parse failure, not absence.
  // Refuse — writing the stripped payload against an unreadable baseline is the incident itself.
  if (!baseline || typeof baseline !== 'object' || !Array.isArray((baseline as EdgesData).edges)) {
    throw new ActionableError({
      goal: 'Preserve edge rationale across a whole-file edges.json save',
      problem: 'The on-disk edges.json baseline could not be read as a valid { edges: [...] } object (read or parse failure). Refusing to save — writing the payload against an unreadable baseline would wipe rationale.',
      location: 'lib/edges/mergeEdgesPreservingRationale.ts mergeEdgesPreservingRationale',
      nextSteps: [
        'Confirm the edges.json on disk is present and valid JSON before saving.',
        'For a genuine first write (no edges.json yet), pass ABSENT_BASELINE, not a null/failed read.',
      ],
    });
  }

  // Index baseline edges that CARRY a (non-empty) rationale, by composite key — restoration sources.
  const baseByKey = new Map<string, Edge[]>();
  for (const e of baseline.edges) {
    if (!hasRationale(e)) continue;
    const k = keyOf(e);
    const bucket = baseByKey.get(k);
    if (bucket) bucket.push(e); else baseByKey.set(k, [e]);
  }

  const edges = incoming.edges.map((edge) => {
    if (hasRationale(edge)) return edge;               // intentional edit / new rationale — keep
    const candidates = baseByKey.get(keyOf(edge));
    if (!candidates || candidates.length === 0) return edge; // nothing on the baseline to restore

    if (candidates.length === 1) return restoreFrom(edge, candidates[0]);

    // Non-unique key (twins): disambiguate on discovered_at + model.
    const matches = candidates.filter(c => c.discovered_at === edge.discovered_at && c.model === edge.model);
    if (matches.length === 1) return restoreFrom(edge, matches[0]);
    if (matches.length === 0) {
      // No twin matched: a rationale that exists is about to not be written. Not a guess, but not
      // silent either (CL Issue 4) — surface it so a systematic tie-break mismatch is discoverable.
      onWarn?.({
        message: `Edge rationale not restored: key "${keyOf(edge)}" is a baseline twin (${candidates.length} rationaled edges) but none matched the incoming edge's discovered_at/model`,
        data: { key: keyOf(edge), candidateCount: candidates.length, incoming_discovered_at: edge.discovered_at ?? null, incoming_model: edge.model ?? null },
      });
      return edge;
    }

    // Still ambiguous after the tie-break — indistinguishable twins. Refuse, never guess.
    throw new ActionableError({
      goal: 'Preserve edge rationale across a whole-file edges.json save',
      problem: `Ambiguous rationale attribution for edge "${keyOf(edge)}": ${matches.length} on-disk edges share the same source|type|target AND discovered_at (${String(edge.discovered_at)}) AND model (${String(edge.model)}) — which rationale to restore cannot be determined.`,
      location: 'lib/edges/mergeEdgesPreservingRationale.ts mergeEdgesPreservingRationale',
      nextSteps: [
        'Disambiguate the duplicate edges in edges.json (give them distinct discovered_at or model), or remove the true duplicate.',
        'Do not save until the ambiguity is resolved — saving now would guess which rationale belongs to which edge.',
      ],
    });
  });

  return { ...incoming, edges };
}
