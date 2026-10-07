// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * The POV-tag proposal side file, `taxonomy/Origin/pov-tag-proposals.json` (t/4052; spec t3935 §7 step 4).
 * t/3962 writes it; the editor's review queue records one decision per item in it; the frozen list for the
 * authorized `pov_tags` write is built from it. Review NEVER writes `pov_tags` itself.
 *
 * Defined once here so the Electron IPC handler (t/4054) and the server route (t/4055) can't drift. PURE: no I/O.
 *
 * Field rules (spec §7.4):
 *   - `proposed` / `final`: arrays of registry tag ids for the node's POV; `[]` = intentionally untagged.
 *   - `status`: `pending` | `accepted` (final = proposed) | `modified` (final ≠ proposed) | `rejected` (final = []).
 *   - `final`, `reviewed_by`, `reviewed_at`: null until reviewed.
 * Unknown keys (e.g. `crux`) and key order are preserved: the whole-file rewrite round-trips byte-identically.
 */

import { validatePovTagsDetailed, loadPovTagRegistry, type PovTagRegistry } from './povTags.js';
import type { SoulProvenance } from '../debate/soulDocSchema.js';

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'modified', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface PovTagProposal {
  node_id: string;
  proposed: string[];
  status: ProposalStatus;
  final: string[] | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  confidence?: number;
  rationale?: string;
  /** Reviewer display only (see the value_basis section below). */
  value_basis?: ValueBasis[];
  value_basis_shared?: ValueBasisShared;
  value_basis_nearest?: ValueBasisNearest;
  [key: string]: unknown;
}

export interface PovTagProposalsFile {
  version: number;
  proposals: PovTagProposal[];
  /** Present once the t/4066 justify pass has been written; see {@link ValueBasisRun}. */
  value_basis_run?: ValueBasisRun;
  [key: string]: unknown;
}

// ── value_basis: why each proposed tag fits its soul doc's Value Hierarchy (t/4066, SO e/278) ──────────────────────
//
// EXEMPTION (SO e/278#2 cond. 2): value_basis* is REVIEWER DISPLAY ONLY. No consumer branches on it, which is why
// adding these fields was not a mandatory-SO data-model change. THE EXEMPTION LAPSES the moment selection, the
// frozen-list build, or any automated decision reads it.
//
// INDICES ARE 1-BASED: `vh_index: [1]` is the FIRST element of the matching `value_basis_run.value_hierarchies` array
// (CL e/278#3). The text always comes from that snapshot, never from the live soul doc, so a later soul edit can't
// silently change what a citation says. parsePovTagProposals refuses any index outside its array.
// Firm = cited in both of two runs; uncertain = cited in exactly one; unsupported = neither run cited an element.

/** One proposed tag's justification. `vh_index: null` means unsupported. */
export interface ValueBasis {
  tag: string;
  vh_index: number[] | null;
  vh_index_uncertain: number[];
  why: string;
  unsupported: boolean;
}

/** "both" items only: the base skeptic soul's shared-ground element(s), indexed into `value_hierarchies.shared`. */
export interface ValueBasisShared {
  vh_index: number[] | null;
  vh_index_uncertain: number[];
  why: string;
  unsupported: boolean;
}

/** Untagged items only: the closest tag and element, if any. `tag: null` requires `vh_index: null`. */
export interface ValueBasisNearest {
  tag: string | null;
  vh_index: number | null;
  why: string;
  agree: boolean;
}

/** The run block, stored once at the top level. `value_hierarchies` is the text snapshot every index resolves into. */
export interface ValueBasisRun {
  /** Always 1: indices are 1-based. Anything else is refused, since the bounds check assumes it. */
  index_base?: 1;
  value_hierarchies: Record<string, string[]>;
  /**
   * Per-soul fingerprint from the canonical `buildSoulProvenance` (fnv1a64), compared with `compareSoulProvenance`
   * (SO e/278#5-#7). The queue's "soul doc changed since justification" note keys off this, never off a second hash.
   */
  soul_provenance?: Record<string, SoulProvenance>;
  [key: string]: unknown;
}

/** A reviewer's decision. `final` is required for `modified` and must be absent or `[]` for `rejected`. */
export interface ProposalDecision {
  status: 'accepted' | 'modified' | 'rejected';
  final?: string[];
}

/** What applyProposalDecision returns; the IPC handler and route return it as-is (409 on a refusal). */
export type ApplyProposalDecisionResult =
  | { file: PovTagProposalsFile; item: PovTagProposal }
  | { refused: 'conflict' | 'invalid'; problems: string[] };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNullableString = (v: unknown) => v === null || typeof v === 'string';

function itemProblems(item: unknown, i: number): string[] {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`proposals[${i}] is not an object`];
  const p = item as Record<string, unknown>;
  const at = typeof p.node_id === 'string' ? `proposals[${i}] (${p.node_id})` : `proposals[${i}]`;
  const problems: string[] = [];
  if (typeof p.node_id !== 'string' || p.node_id === '') problems.push(`${at}: node_id must be a non-empty string`);
  if (!isStringArray(p.proposed)) problems.push(`${at}: proposed must be an array of strings`);
  if (!PROPOSAL_STATUSES.includes(p.status as ProposalStatus)) problems.push(`${at}: status must be one of ${PROPOSAL_STATUSES.join(', ')}`);
  if (!(p.final === null || isStringArray(p.final))) problems.push(`${at}: final must be null or an array of strings`);
  if (!isNullableString(p.reviewed_by)) problems.push(`${at}: reviewed_by must be a string or null`);
  if (!isNullableString(p.reviewed_at)) problems.push(`${at}: reviewed_at must be a string or null`);
  return problems;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The run block's problems, plus the snapshot hierarchies (or null when there's no usable snapshot). */
function runProblems(run: unknown): { problems: string[]; hierarchies: Record<string, string[]> | null } {
  if (run === undefined) return { problems: [], hierarchies: null };
  if (!isObject(run)) return { problems: ['value_basis_run must be an object'], hierarchies: null };
  const problems: string[] = [];
  const vh = run.value_hierarchies;
  let hierarchies: Record<string, string[]> | null = null;
  if (!isObject(vh) || !Object.values(vh).every(isStringArray)) {
    problems.push('value_basis_run.value_hierarchies must be an object of string arrays');
  } else {
    hierarchies = vh as Record<string, string[]>;
  }
  if (run.index_base !== undefined && run.index_base !== 1) problems.push(`value_basis_run.index_base must be 1 (got ${JSON.stringify(run.index_base)}); indices are 1-based`);
  if (run.soul_provenance !== undefined) {
    const sp = run.soul_provenance;
    const ok = isObject(sp) && Object.values(sp).every((p) => isObject(p) && typeof p.file === 'string' && typeof p.hash === 'string');
    if (!ok) problems.push('value_basis_run.soul_provenance must map each soul to { file, hash } strings');
  }
  return { problems, hierarchies };
}

/** A 1-based index list into `hierarchy`; `allowNull` admits null (unsupported). */
function indexProblems(v: unknown, where: string, hierarchy: string[] | undefined, allowNull: boolean): string[] {
  if (v === null && allowNull) return [];
  if (!Array.isArray(v)) return [`${where} must be ${allowNull ? 'null or ' : ''}an array of 1-based indices`];
  if (!hierarchy) return v.length === 0 ? [] : [`${where}: no value_hierarchies snapshot to index into`];
  const bad = v.filter((x) => !Number.isInteger(x) || (x as number) < 1 || (x as number) > hierarchy.length);
  return bad.length === 0 ? [] : [`${where}: ${bad.map(String).join(', ')} out of range 1..${hierarchy.length} (indices are 1-based)`];
}

/** Untagged items: a null tag needs a null index; a tagged index must land inside that tag's snapshot. */
function nearestProblems(n: unknown, where: string, hierarchies: Record<string, string[]>): string[] {
  if (!isObject(n)) return [`${where} must be an object`];
  const problems: string[] = [];
  if (n.tag === null) {
    if (n.vh_index !== null) problems.push(`${where}: vh_index must be null when tag is null`);
  } else if (typeof n.tag !== 'string') problems.push(`${where}.tag must be a string or null`);
  else if (n.vh_index !== null) problems.push(...indexProblems([n.vh_index], `${where}.vh_index`, hierarchies[n.tag], false));
  if (typeof n.why !== 'string') problems.push(`${where}.why must be a string`);
  if (typeof n.agree !== 'boolean') problems.push(`${where}.agree must be a boolean`);
  return problems;
}

/**
 * value_basis* on one item: absent is fine; present must be well formed, with every index inside its snapshot array
 * (SO e/278#2 cond. 1: an out-of-range index would otherwise render the wrong text, or none, with nothing failing).
 */
function valueBasisProblems(p: Record<string, unknown>, at: string, hierarchies: Record<string, string[]> | null): string[] {
  const has = p.value_basis !== undefined || p.value_basis_shared !== undefined || p.value_basis_nearest !== undefined;
  if (!has) return [];
  if (!hierarchies) return [`${at}: has value_basis but the file has no usable value_basis_run.value_hierarchies snapshot`];
  const problems: string[] = [];
  const entryShape = (e: unknown, where: string, hierarchy: string[] | undefined) => {
    if (!isObject(e)) return [`${where} must be an object`];
    const out = [
      ...indexProblems(e.vh_index, `${where}.vh_index`, hierarchy, true),
      ...indexProblems(e.vh_index_uncertain, `${where}.vh_index_uncertain`, hierarchy, false),
    ];
    if (typeof e.why !== 'string') out.push(`${where}.why must be a string`);
    if (typeof e.unsupported !== 'boolean') out.push(`${where}.unsupported must be a boolean`);
    return out;
  };
  if (p.value_basis !== undefined) {
    if (!Array.isArray(p.value_basis)) problems.push(`${at}: value_basis must be an array`);
    else p.value_basis.forEach((e, k) => {
      const where = `${at}: value_basis[${k}]`;
      const tag = isObject(e) ? e.tag : undefined;
      if (typeof tag !== 'string') problems.push(`${where}.tag must be a string`);
      else if (!hierarchies[tag]) problems.push(`${where}: no value_hierarchies snapshot for tag "${tag}"`);
      problems.push(...entryShape(e, where, typeof tag === 'string' ? hierarchies[tag] : undefined));
    });
  }
  if (p.value_basis_shared !== undefined) problems.push(...entryShape(p.value_basis_shared, `${at}: value_basis_shared`, hierarchies.shared));
  if (p.value_basis_nearest !== undefined) problems.push(...nearestProblems(p.value_basis_nearest, `${at}: value_basis_nearest`, hierarchies));
  return problems;
}

/**
 * Shape-check a parsed side file. On success returns the SAME object (not a rebuilt copy), so unknown keys and key
 * order survive. Duplicate node_ids are a problem: a decision must address exactly one item. Optional value_basis*
 * fields are checked when present, including that every index lands inside the run's snapshot (t/4066).
 */
export function parsePovTagProposals(raw: unknown): { ok: true; file: PovTagProposalsFile } | { ok: false; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['the file is not a JSON object'] };
  const f = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof f.version !== 'number') problems.push('version must be a number');
  if (!Array.isArray(f.proposals)) {
    problems.push('proposals must be an array');
    return { ok: false, problems };
  }
  const run = runProblems(f.value_basis_run);
  problems.push(...run.problems);
  const seen = new Set<string>();
  f.proposals.forEach((item, i) => {
    problems.push(...itemProblems(item, i));
    if (isObject(item)) {
      const at = typeof item.node_id === 'string' ? `proposals[${i}] (${item.node_id})` : `proposals[${i}]`;
      problems.push(...valueBasisProblems(item, at, run.hierarchies));
    }
    const id = (item as { node_id?: unknown })?.node_id;
    if (typeof id === 'string') {
      if (seen.has(id)) problems.push(`duplicate node_id ${id}`);
      seen.add(id);
    }
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, file: raw as PovTagProposalsFile };
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sb].every((x) => sa.has(x));
};

/** The `final` a decision produces, or the reason it is invalid. Tag validity is checked separately. */
function finalFor(item: PovTagProposal, decision: ProposalDecision): string[] | string {
  switch (decision.status) {
    case 'accepted':
      if (decision.final !== undefined && !sameSet(decision.final, item.proposed)) return 'accepted means final = proposed; send modified to change the tags';
      return [...item.proposed];
    case 'rejected':
      if (decision.final !== undefined && decision.final.length > 0) return 'rejected means final = [] (intentionally untagged)';
      return [];
    case 'modified':
      if (!isStringArray(decision.final)) return 'modified requires final (an array of tag ids)';
      // CL e/269#3: never store `modified` when nothing changed; it would corrupt the accepted-vs-modified count.
      if (sameSet(decision.final, item.proposed)) return 'final equals proposed; record it as accepted, not modified';
      return [...decision.final];
    default:
      return `status must be accepted, modified or rejected (got ${JSON.stringify((decision as { status: unknown }).status)})`;
  }
}

/**
 * Record one reviewer decision on one item. Returns a NEW file (the input is never mutated) with only that item's
 * `status`, `final`, `reviewed_by` and `reviewed_at` changed, or a refusal:
 *   - `conflict`: the item's current status isn't `expectedStatus` (someone else reviewed it since it was loaded);
 *   - `invalid`: unknown node, a malformed decision, empty reviewer, or a `final` that fails `validatePovTagsDetailed`
 *     for the node's POV (also for `accepted`, so a tag retired since proposal can't be accepted).
 */
export function applyProposalDecision(
  file: PovTagProposalsFile,
  nodeId: string,
  decision: ProposalDecision,
  reviewedBy: string,
  reviewedAt: string,
  expectedStatus: ProposalStatus,
  registry: PovTagRegistry = loadPovTagRegistry(),
): ApplyProposalDecisionResult {
  const index = file.proposals.findIndex((p) => p.node_id === nodeId);
  if (index < 0) return { refused: 'invalid', problems: [`no proposal for node ${nodeId}`] };
  const item = file.proposals[index];
  if (item.status !== expectedStatus) {
    return { refused: 'conflict', problems: [`${nodeId} is ${item.status}, expected ${expectedStatus}; reload and review again`] };
  }
  if (typeof reviewedBy !== 'string' || reviewedBy.trim() === '') return { refused: 'invalid', problems: ['reviewed_by must be a non-empty string'] };
  if (typeof reviewedAt !== 'string' || Number.isNaN(Date.parse(reviewedAt))) return { refused: 'invalid', problems: ['reviewed_at must be an ISO date-time'] };

  const final = finalFor(item, decision);
  if (typeof final === 'string') return { refused: 'invalid', problems: [`${nodeId}: ${final}`] };
  if (final.length > 0) {
    const tagProblems = validatePovTagsDetailed(nodeId, final, registry);
    if (tagProblems.length > 0) return { refused: 'invalid', problems: tagProblems.map((p) => p.message) };
  }

  // Spread keeps the item's key order: every assigned key already exists on a well-formed item.
  const next: PovTagProposal = { ...item, status: decision.status, final, reviewed_by: reviewedBy, reviewed_at: reviewedAt };
  const proposals = file.proposals.slice();
  proposals[index] = next;
  return { file: { ...file, proposals }, item: next };
}

/** The one serializer: 2-space JSON plus a trailing LF, byte-identical to the committed file (187,089 bytes, checked 2026-10-07 at data 02c0c2c9). */
export function serializePovTagProposals(file: PovTagProposalsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
