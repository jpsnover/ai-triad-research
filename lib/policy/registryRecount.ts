// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * The TypeScript copy of the policy-registry member recount (t/4034). It MIRRORS PowerShell's
 * `Update-PolicyMemberCounts` in node-scoped mode (scripts/AITriad/Private/PolicyRegistryCore.ps1, t/4004); the
 * two must not diverge, so the rule is stated here once and tested case for case.
 *
 * For each id in `ids` that the registry knows:
 *   - `member_count` = the number of `graph_attributes.policy_actions` ENTRIES referencing it across the four POV
 *     files (accelerationist, safetyist, skeptic, situations). Entries, not nodes: a node listing an id twice
 *     counts 2 (PowerShell e/264#3).
 *   - `source_povs` = the sorted, unique POV keys of those entries.
 *   - Referenced nowhere now: `member_count = 0`, `source_povs` left as it was.
 *   - Only a TRUTHY `policy_id` is a reference; null, undefined and '' are unregistered (PowerShell e/264#3).
 *   - `status` is added as 'active' only when the property is MISSING; an existing value (e.g. 'superseded') is kept.
 * Unknown ids are ignored. Every other field, and every other policy, is preserved.
 *
 * PURE: no I/O. The callers (Electron IPC t/4038, server route t/4039) own the read, the lock (t/4028) and the
 * write. They should write only when `changed` is true, and only with `serializePolicyRegistry`, which reproduces
 * the committed file byte for byte, so the editor and PowerShell never fight over formatting (PowerShell e/264#7).
 */

import type { PolicyAction } from './types.js';

/** The four files a recount scans, in PowerShell's `$script:PolicyPovFiles` order. */
export const POLICY_POV_FILES = ['accelerationist', 'safetyist', 'skeptic', 'situations'] as const;
export type PolicyPovFile = (typeof POLICY_POV_FILES)[number];

/** policy_actions.json as stored: header fields plus the policies array. */
export interface PolicyRegistry {
  policies: PolicyAction[];
  [key: string]: unknown;
}

/** Just the part of a taxonomy file the recount reads. */
export interface PolicyPovFileData {
  nodes?: { id?: unknown; graph_attributes?: { policy_actions?: unknown } | null }[];
}

export interface RecountUpdate {
  id: string;
  member_count: number;
  source_povs: string[];
}

/** The contract name Rosetta's AppAPI uses (e/264#10). */
export type PolicyCountUpdate = RecountUpdate;

/**
 * What `recount-policy-members` (Electron IPC t/4038) and `POST /api/policy-registry/recount` (server t/4039) return
 * (Rosetta e/264#10). Defined once here so the two handlers can't drift. Handler order (PowerShell e/264#11): take
 * `policy_actions.lock` (held by another writer → `refused: 'locked'`), then read + `recountPolicyMembers`;
 * `changed === false` → `unchanged`; else write with `serializePolicyRegistry` → `written`; release the lock in a
 * `finally`. Any other failure throws.
 *
 * NO DIRTY-REGISTRY REFUSAL — an exemption from PowerShell's BLOCK-tier rule, approved by the PI 2026-10-07 (option (a),
 * e/264#20–#29). PowerShell refuses a dirty `policy_actions.json` so that ITS OWN COMMIT can't sweep someone else's
 * uncommitted registry edits. This writer never commits on desktop (Electron `syncCommit` is a no-op), and on the web
 * every write is committed to the session branch, so there is no "dirty" state there. The recount re-reads the file
 * under the lock and changes only `member_count` / `source_povs`, so any uncommitted edit is carried through intact.
 * Surviving vectors, all DESKTOP-ONLY (t/4034#8, #10):
 *   1. An external editor holding the file open and saving a stale buffer after a recount reverts the counts until
 *      the next recount (the lock can't see it).
 *   2. While the recounted file stays uncommitted, PowerShell registry writers refuse it by design, so the next
 *      pipeline run leaves new policy actions unregistered (WARN + remedy). MITIGATED, NOT CLOSED: the desktop
 *      `needs-commit` notice (#3022) tells the user to commit first, but nothing blocks the run.
 *   3. A pipeline step whose commit includes `policy_actions.json` sweeps the editor's count changes into an
 *      unrelated commit (the t/3943 "unattributed" shape; counts only).
 * THE EXEMPTION LAPSES (TL p/336#587) if desktop ever commits the registry, or the recount writes any field other than
 * `member_count` / `source_povs` / a missing `status`; at that point the dirty-registry refusal comes back. The
 * byte-level test in registryRecount.test.ts pins the second half.
 * The variant was removed with no consumer branching on it (t/4034#7); if a handler ever needs to refuse for another
 * reason, add a new `reason` rather than reviving this one.
 */
export type RecountPolicyMembersResult =
  | { status: 'written'; updated: PolicyCountUpdate[] }
  | { status: 'unchanged'; updated: [] }
  | { status: 'refused'; reason: 'locked'; updated: PolicyCountUpdate[] };

export interface RecountResult {
  /** A new registry; the input is never mutated. */
  registry: PolicyRegistry;
  /** One entry per known target id, in first-seen order of `ids`. */
  updated: RecountUpdate[];
  /** False when the recount changed nothing, so the caller can skip the write (PowerShell e/264#7). */
  changed: boolean;
}

/** One node's policy_actions as an array, like PowerShell's `@(...)`: a lone object counts as one entry. */
function policyActionsOf(node: { graph_attributes?: { policy_actions?: unknown } | null } | undefined): unknown[] {
  const pa = node?.graph_attributes?.policy_actions;
  if (pa === undefined || pa === null) return [];
  return Array.isArray(pa) ? pa : [pa];
}

/** policy_id -> the POV key of every entry that references it (one element per entry). */
function scanReferences(povFiles: Partial<Record<PolicyPovFile, PolicyPovFileData | undefined>>): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const pov of POLICY_POV_FILES) {
    for (const node of povFiles[pov]?.nodes ?? []) {
      for (const entry of policyActionsOf(node)) {
        const id = entry && typeof entry === 'object' ? (entry as { policy_id?: unknown }).policy_id : undefined;
        if (!id) continue; // null / undefined / '' are unregistered, not references
        const key = String(id);
        refs.set(key, [...(refs.get(key) ?? []), pov]);
      }
    }
  }
  return refs;
}

export function recountPolicyMembers(
  registry: PolicyRegistry,
  povFiles: Partial<Record<PolicyPovFile, PolicyPovFileData | undefined>>,
  ids: readonly string[],
): RecountResult {
  const refs = scanReferences(povFiles);
  const targets = new Set(ids);
  const updated: RecountUpdate[] = [];
  let changed = false;
  const byId = new Map<string, RecountUpdate>();

  const policies = registry.policies.map((policy) => {
    if (!targets.has(policy.id)) return policy;
    const next: PolicyAction = { ...policy };
    const found = refs.get(policy.id);
    if (found) {
      next.member_count = found.length;
      next.source_povs = [...new Set(found)].sort();
    } else {
      next.member_count = 0; // node-scoped: referenced nowhere now; source_povs left as it was
    }
    if (!Object.prototype.hasOwnProperty.call(policy, 'status')) next.status = 'active';
    // Exact: the policy as it will be serialized, before vs after (a key added, like status, counts as a change).
    if (JSON.stringify(next) !== JSON.stringify(policy)) changed = true;
    byId.set(policy.id, { id: policy.id, member_count: next.member_count, source_povs: [...(next.source_povs ?? [])] });
    return next;
  });

  for (const id of targets) {
    const u = byId.get(id);
    if (u) updated.push(u);
  }
  return { registry: { ...registry, policies }, updated, changed };
}

/**
 * The one serializer for policy_actions.json from TypeScript: 2-space JSON plus a trailing LF. Checked against the
 * committed file on 2026-10-07: byte-identical (PowerShell e/264#7 point 3), so an editor write changes only the
 * fields it recounted.
 */
export function serializePolicyRegistry(registry: PolicyRegistry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}
