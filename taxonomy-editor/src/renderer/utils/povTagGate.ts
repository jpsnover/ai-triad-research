// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovNode } from '../types/taxonomy';
import type { ValidationErrors } from './validation';
import { loadPovTagRegistry, POV_BY_ID_PREFIX, type PovTagRegistry } from '@lib/schema/povTags';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

// ── POV-tag registry membership on save (t/3973, refined in t/3961) ──
// A tag the registry later retires must not block saving. Structural problems still block everywhere
// (validation.ts). Membership blocks only tags ADDED since load/save that aren't registered: that is the
// guarantee e/249#6 cond 2 is for ("no edit introduces an unregistered tag"). An orphan a node already
// carried is a WARN plus the t/3984 notice. Removing or reordering tags never blocks, which matters now
// that the editor can edit tags (t/3961; SO e/253#2 note): removing a valid tag from a node that still
// carries an orphan must save, or the user is stuck.

/** node id → fingerprint of its pov_tags, as last loaded or saved. */
export function buildPovTagBaseline(nodes: PovNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map(n => [n.id, JSON.stringify(n.pov_tags ?? null)]));
}

/** Unregistered tags added since the baseline, as errors keyed nodes.<id>.pov_tags.
 *  `registry` is for tests only (the committed registry is empty until t/3956). */
export function povTagMembershipErrors(nodes: PovNode[], baseline: Record<string, string>, registry?: PovTagRegistry): ValidationErrors {
  return povTagMembership(nodes, baseline, registry).errors;
}

/** The tag ids a stored fingerprint held (none for an absent node or untagged one). */
function baselineTags(fingerprint: string | undefined): Set<string> {
  const v: unknown = fingerprint === undefined ? null : JSON.parse(fingerprint);
  return new Set(Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : []);
}

/** Registered tag ids for the node's POV, or null for a non-POV node (structural; the schema's job). */
function allowedTagsFor(nodeId: string, registry: PovTagRegistry): Set<string> | null {
  const pov = POV_BY_ID_PREFIX[/^([a-z]+)-/.exec(nodeId)?.[1] ?? ''];
  if (!pov) return null;
  return new Set((registry.povs[pov as keyof PovTagRegistry['povs']] ?? []).map(t => t.id));
}

/** As povTagMembershipErrors, plus the ids of nodes still carrying orphaned (already-present, unregistered)
 *  tags, so the editor can show them after the save, not only in the flight recorder (t/3984). */
export function povTagMembership(nodes: PovNode[], baseline: Record<string, string>, registry: PovTagRegistry = loadPovTagRegistry()): { errors: ValidationErrors; orphanedNodeIds: string[] } {
  const errors: ValidationErrors = {};
  const orphans: Array<{ node_id: string; tags: string[] }> = [];
  for (const node of nodes) {
    if (!Array.isArray(node.pov_tags)) continue; // absent = untagged; a scalar is structural (schema blocks it)
    const allowed = allowedTagsFor(node.id, registry);
    if (!allowed) continue;
    const unregistered = node.pov_tags.filter((t): t is string => typeof t === 'string' && !allowed.has(t));
    if (unregistered.length === 0) continue;
    const before = baselineTags(baseline[node.id]);
    const added = unregistered.filter(t => !before.has(t));
    const kept = unregistered.filter(t => before.has(t));
    if (added.length > 0) {
      errors[`nodes.${node.id}.pov_tags`] = added.map(t => `${node.id}: tag "${t}" is not registered`).join('; ');
    }
    if (kept.length > 0) orphans.push({ node_id: node.id, tags: kept });
  }
  if (orphans.length > 0) {
    getGlobalRecorder()?.record({
      type: 'state.change', component: 'taxonomy-store', level: 'warn',
      message: 'Saving despite unregistered POV tags already on nodes (orphaned by a registry change?)',
      data: { count: orphans.length, nodes: orphans.slice(0, 20) },
    });
  }
  return { errors, orphanedNodeIds: orphans.map(o => o.node_id) };
}
