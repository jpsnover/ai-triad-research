// Pure client-side delta builder for incremental debate save (t/1637, parent t/1470).
//
// Given the last-synced snapshot (`base`) and the current in-memory session
// (`current`), produce the smallest `DebateDelta` that `applyDebateDelta` (server,
// lib/debate/applyDebateDelta.ts) will merge back into an identical session — or
// signal that a full PUT is required.
//
// DESIGN INVARIANT — over-report-safe, never under-report:
//   The deep-equality primitive is `JSON.stringify(a) === JSON.stringify(b)`.
//   A false NEGATIVE (two equal values compared unequal — e.g. reordered object
//   keys) is SAFE: it sends extra unchanged data, which the server merges
//   idempotently. A false POSITIVE (two unequal values compared equal) would drop
//   a real change — this comparison cannot produce one for our value shapes
//   (plain JSON: no functions, no cyclic refs, no undefined-vs-absent traps that
//   matter for a save round-trip). So the builder can over-report but never
//   under-report.
//
// APPEND-ONLY SURFACES — transcript and argument_network.mutations are append-only
//   in the delta model (`newTranscriptEntries` / `newMutations` are concatenated to
//   the base tail; there is no "edit entry i" or "remove entry i" primitive). If the
//   current array is SHORTER than base, or any shared-index entry changed in place,
//   the delta cannot represent it — we return `{ kind: 'full' }` so the caller falls
//   back to a full PUT.

import type {
  DebateSession,
  DebateDelta,
  TranscriptEntry,
  ArgumentNetworkNode,
  ArgumentNetworkEdge,
  ANMutation,
} from '@lib/debate/types';

export type BuildDeltaResult =
  | { kind: 'empty' }
  | { kind: 'full' }
  | { kind: 'delta'; delta: DebateDelta };

/** Deep-equality via canonical JSON. False negatives are safe (over-report); see file header. */
function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Append-only tail diff. Returns the entries of `current` beyond `base` when
 * `current` is a clean extension of `base`, or `null` when it is NOT (shorter, or a
 * shared-index entry changed in place) — signalling the caller to full-PUT.
 */
function appendOnlyTail<T>(base: readonly T[], current: readonly T[]): T[] | null {
  if (current.length < base.length) return null;
  for (let i = 0; i < base.length; i++) {
    if (!jsonEq(base[i], current[i])) return null;
  }
  return current.slice(base.length);
}

/** Structured-surface keys handled explicitly; excluded from the generic changedFields overlay. */
const STRUCTURED_KEYS = new Set<string>([
  'transcript',
  'argument_network',
  'turn_embeddings',
  '_saveVersion',
  'title',
  'updated_at',
  'phase',
  'id',
]);

/**
 * Diff a by-id collection. Returns `changed` (new-or-modified, upsert last-wins) and
 * `removedIds` (present in base, absent in current). Purely additive/overlay — never
 * mutates inputs.
 */
function diffById<T extends { id: string }>(
  base: readonly T[],
  current: readonly T[],
): { changed: T[]; removedIds: string[] } {
  const baseMap = new Map(base.map((x) => [x.id, x]));
  const curMap = new Map(current.map((x) => [x.id, x]));
  const changed: T[] = [];
  for (const [id, cur] of curMap) {
    const prev = baseMap.get(id);
    if (!prev || !jsonEq(prev, cur)) changed.push(cur);
  }
  const removedIds: string[] = [];
  for (const id of baseMap.keys()) {
    if (!curMap.has(id)) removedIds.push(id);
  }
  return { changed, removedIds };
}

/**
 * Append/upsert-by-key diff for a keyed map (`turn_embeddings`: transcript-entry id →
 * 384-dim vector — large and monotonically growing). Returns `newEntries` (keys present
 * in `current` that are absent from, or differ from, `base`) and `representable`.
 *
 * `representable` is false when a base KEY is absent in current — a removal, which an
 * append/upsert surface cannot express — signalling the caller to full-PUT. This mirrors
 * {@link appendOnlyTail}'s truncation fallback: any shape the structured surface cannot
 * carry degrades to a full PUT rather than silently losing data. Over-report-safe: an
 * in-place value change re-sends that one key (idempotent upsert), never drops it.
 */
function diffAppendByKey(
  base: Record<string, number[]> | undefined,
  current: Record<string, number[]> | undefined,
): { newEntries: Record<string, number[]>; representable: boolean } {
  const b = base ?? {};
  const c = current ?? {};
  // A key present in base but absent in current is a removal — unrepresentable.
  for (const k of Object.keys(b)) {
    if (!(k in c)) return { newEntries: {}, representable: false };
  }
  const newEntries: Record<string, number[]> = {};
  for (const k of Object.keys(c)) {
    if (!(k in b) || !jsonEq(b[k], c[k])) newEntries[k] = c[k];
  }
  return { newEntries, representable: true };
}

/**
 * Build the delta from `base` (last synced) to `current` (in memory), computed
 * against `baseVersion`. Pure — does no I/O, mutates neither argument.
 *
 * Returns:
 *   - `{ kind: 'empty' }` — nothing changed; caller skips the network round-trip.
 *   - `{ kind: 'full' }`  — a change the delta model cannot represent (in-place
 *                            transcript/mutation edit or truncation); caller full-PUTs.
 *   - `{ kind: 'delta', delta }` — the minimal (over-report-safe) incremental payload.
 */
export function buildDebateDelta(
  base: DebateSession,
  current: DebateSession,
  baseVersion: number,
): BuildDeltaResult {
  // ── Append-only surfaces: transcript ──
  const newTranscriptEntries = appendOnlyTail<TranscriptEntry>(
    base.transcript ?? [],
    current.transcript ?? [],
  );
  if (newTranscriptEntries === null) return { kind: 'full' };

  // ── Append-only surfaces: argument_network.mutations ──
  const baseMutations = base.argument_network?.mutations ?? [];
  const curMutations = current.argument_network?.mutations ?? [];
  const newMutations = appendOnlyTail<ANMutation>(baseMutations, curMutations);
  if (newMutations === null) return { kind: 'full' };

  // ── Append/upsert-by-key surface: turn_embeddings (large, monotonically growing) ──
  // Sent as new-keys-only so per-save upload scales with turns ADDED, not total turns.
  // A key removal is unrepresentable by this surface → fall back to a full PUT.
  const { newEntries: newTurnEmbeddings, representable: turnEmbeddingsRepresentable } =
    diffAppendByKey(base.turn_embeddings, current.turn_embeddings);
  if (!turnEmbeddingsRepresentable) return { kind: 'full' };

  // ── argument_network nodes / edges: by-id upsert + remove ──
  const baseNodes: ArgumentNetworkNode[] = base.argument_network?.nodes ?? [];
  const curNodes: ArgumentNetworkNode[] = current.argument_network?.nodes ?? [];
  const { changed: changedNodes, removedIds: removedNodeIds } = diffById(baseNodes, curNodes);

  const baseEdges: ArgumentNetworkEdge[] = base.argument_network?.edges ?? [];
  const curEdges: ArgumentNetworkEdge[] = current.argument_network?.edges ?? [];
  const { changed: changedEdges, removedIds: removedEdgeIds } = diffById(baseEdges, curEdges);

  // ── meta: title / updated_at / phase ──
  const meta: Partial<Pick<DebateSession, 'title' | 'updated_at' | 'phase'>> = {};
  if (!jsonEq(base.title, current.title)) meta.title = current.title;
  if (!jsonEq(base.updated_at, current.updated_at)) meta.updated_at = current.updated_at;
  if (!jsonEq(base.phase, current.phase)) meta.phase = current.phase;

  // ── changedFields: generic top-level overlay for every non-structured analytics field ──
  const changedFields: Record<string, unknown> = {};
  const baseRec = base as unknown as Record<string, unknown>;
  const curRec = current as unknown as Record<string, unknown>;
  const allKeys = new Set<string>([...Object.keys(baseRec), ...Object.keys(curRec)]);
  for (const k of allKeys) {
    if (STRUCTURED_KEYS.has(k)) continue;
    if (!jsonEq(baseRec[k], curRec[k])) changedFields[k] = curRec[k];
  }

  const hasChanges =
    newTranscriptEntries.length > 0 ||
    newMutations.length > 0 ||
    changedNodes.length > 0 ||
    changedEdges.length > 0 ||
    removedNodeIds.length > 0 ||
    removedEdgeIds.length > 0 ||
    Object.keys(meta).length > 0 ||
    Object.keys(newTurnEmbeddings).length > 0 ||
    Object.keys(changedFields).length > 0;

  if (!hasChanges) return { kind: 'empty' };

  const delta: DebateDelta = {
    debateId: current.id,
    baseVersion,
    newTranscriptEntries,
    changedNodes,
    changedEdges,
    newMutations,
  };
  if (removedNodeIds.length > 0) delta.removedNodeIds = removedNodeIds;
  if (removedEdgeIds.length > 0) delta.removedEdgeIds = removedEdgeIds;
  if (Object.keys(meta).length > 0) delta.meta = meta;
  if (Object.keys(changedFields).length > 0) {
    delta.changedFields = changedFields as Partial<DebateSession>;
  }
  if (Object.keys(newTurnEmbeddings).length > 0) {
    delta.newTurnEmbeddings = newTurnEmbeddings;
  }

  return { kind: 'delta', delta };
}
