// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { PovNode } from '../types/taxonomy';
import type { ValidationErrors } from './validation';
import { validatePovTagsDetailed, type PovTagRegistry } from '@lib/schema/povTags';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

// ── t/3973: POV-tag registry membership is gated on nodes changed since load/save ──
// A tag the registry later retires must not block every save of its POV file (the editor has no tag UI
// to fix it, t/3961). Structural problems still block everywhere (validation.ts); only "not registered"
// is per-node: blocking on an edited node, a WARN on an untouched one. Same pattern as t/3888's BDI gate.

/** node id → fingerprint of its pov_tags, as last loaded or saved. */
export function buildPovTagBaseline(nodes: PovNode[]): Record<string, string> {
  return Object.fromEntries(nodes.map(n => [n.id, JSON.stringify(n.pov_tags ?? null)]));
}

/** Unregistered-tag errors for changed nodes; untouched nodes with orphaned tags are WARNed, not blocked.
 *  `registry` is for tests only (the committed registry is empty until t/3956). */
export function povTagMembershipErrors(nodes: PovNode[], baseline: Record<string, string>, registry?: PovTagRegistry): ValidationErrors {
  const errors: ValidationErrors = {};
  const orphansOnUntouched: Array<{ node_id: string; problems: string[] }> = [];
  for (const node of nodes) {
    const unregistered = validatePovTagsDetailed(node.id, node.pov_tags, registry).filter(p => p.kind === 'unregistered');
    if (unregistered.length === 0) continue;
    if (baseline[node.id] !== JSON.stringify(node.pov_tags ?? null)) {
      errors[`nodes.${node.id}.pov_tags`] = unregistered.map(p => p.message).join('; ');
    } else {
      orphansOnUntouched.push({ node_id: node.id, problems: unregistered.map(p => p.message) });
    }
  }
  if (orphansOnUntouched.length > 0) {
    getGlobalRecorder()?.record({
      type: 'state.change', component: 'taxonomy-store', level: 'warn',
      message: 'Saving despite unregistered POV tags on untouched nodes (orphaned by a registry change?)',
      data: { count: orphansOnUntouched.length, nodes: orphansOnUntouched.slice(0, 20) },
    });
  }
  return errors;
}
