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
  [key: string]: unknown;
}

export interface PovTagProposalsFile {
  version: number;
  proposals: PovTagProposal[];
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

/**
 * Shape-check a parsed side file. On success returns the SAME object (not a rebuilt copy), so unknown keys and key
 * order survive. Duplicate node_ids are a problem: a decision must address exactly one item.
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
  const seen = new Set<string>();
  f.proposals.forEach((item, i) => {
    problems.push(...itemProblems(item, i));
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

/** The one serializer: 2-space JSON plus a trailing LF, byte-identical to the committed file (checked 2026-10-07). */
export function serializePovTagProposals(file: PovTagProposalsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
