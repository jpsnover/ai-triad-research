// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Save-time BDI gate for situations (t/3888). The rule itself lives in ONE place —
// findSituationBdiViolations / validateBdiFields in lib/debate/taxonomyTypes.ts (t/3889),
// pinned to the PowerShell classifier Test-SituationBdiDecomposition by a parity test.
// This module only decides WHICH situations to check (changed-only, SO e/244#2 Q1) and
// formats the refusal. It must never re-encode what counts as "empty" — that would be a
// fifth copy of the rule (t/3888#5, rule-copies table).

import { findSituationBdiViolations, validateBdiFields } from '@lib/debate/taxonomyTypes';
import type { SituationNode } from '@lib/debate/taxonomyTypes';

const BDI_FIELDS = ['belief', 'desire', 'intention'] as const;

/** Order-independent key of a node's interpretations — the deep compare behind changed-only. */
export function interpretationsKey(interpretations: unknown): string {
  return JSON.stringify(interpretations, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
    }
    return value;
  });
}

/** Snapshot of what is on disk: node id → interpretations key. */
export function buildSituationBaseline(nodes: SituationNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map(n => [n.id, interpretationsKey(n.interpretations)]));
}

/** Situations whose interpretations changed vs the baseline. A node absent from the baseline
 *  (new, or renamed) counts as changed (SO Q1 condition 2). Other field edits don't count:
 *  "changed" is defined over `interpretations` only (SO Q1 condition 1). */
export function changedSituations(nodes: SituationNode[], baseline: Record<string, string>): SituationNode[] {
  return nodes.filter(n => baseline[n.id] !== interpretationsKey(n.interpretations));
}

/** Every failing B/D/I field of one interpretation, found by probing the shared rule one
 *  field at a time — so the message can name all of them without re-encoding the rule. */
function failingFields(interp: unknown): string[] {
  if (validateBdiFields(interp) === 'not-object') return [];
  const obj = interp as Record<string, unknown>;
  const valid = { belief: 'ok', desire: 'ok', intention: 'ok' };
  return BDI_FIELDS.filter(f => validateBdiFields({ ...valid, [f]: obj[f] }) !== null);
}

export interface SituationBdiRefusal {
  /** Keyed `nodes.<id>.interpretations.<pov>`, the shape SituationDetail's err() reads. */
  errors: Record<string, string>;
  /** Names every offending node, POV and field (TL t/3888#2/#4: actionable refusal). */
  message: string;
}

/** Validate the changed situations; null when the save may proceed. */
export function checkSituationBdi(nodes: SituationNode[], baseline: Record<string, string>): SituationBdiRefusal | null {
  const violations = findSituationBdiViolations(changedSituations(nodes, baseline));
  if (violations.length === 0) return null;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const errors: Record<string, string> = {};
  const lines: string[] = [];
  for (const v of violations) {
    const node = byId.get(v.id);
    const fields = failingFields(node?.interpretations[v.pov as keyof SituationNode['interpretations']]);
    const problem = fields.length > 0
      ? `${fields.join(', ')} ${fields.length === 1 ? 'is' : 'are'} empty or a placeholder (N/A, TBD, none…)`
      : 'is not broken into belief, desire and intention';
    errors[`nodes.${v.id}.interpretations.${v.pov}`] = `${v.pov}: ${problem}`;
    lines.push(`• ${v.id} "${node?.label || '(no label)'}" — ${v.pov}: ${problem}`);
  }
  const message =
    `Can't save situations: ${violations.length} interpretation${violations.length === 1 ? '' : 's'} `
    + `aren't fully broken into belief, desire and intention. Complete these, or delete the situation:\n`
    + lines.join('\n');
  return { errors, message };
}
