// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// What a successful save makes the new "as last saved" state for the store's gates (t/3888 situations,
// t/3973 tags, t/4034 policy ids). Split out of taxonomyDataSlice.ts to keep it under max-lines.

import type { TaxonomyDataSlice } from './taxonomyDataSlice';
import { POV_KEYS } from '@lib/debate/types';
import { buildPovTagBaseline } from '../../../utils/povTagGate';
import { buildSituationBaseline } from '../../../utils/situationBdiGate';
import { buildPolicyIdBaseline, type PolicyBearingNode } from '../../../utils/policyRecount';

type BaselineState = Pick<TaxonomyDataSlice, 'accelerationist' | 'safetyist' | 'skeptic' | 'situations' | 'povTagsBaseline' | 'policyIdsBaseline'>;

/** Nodes in the POV and situations files this save wrote: the files whose policy_actions can change. */
export function savedPolicyNodes(dirtyKeys: Set<string>, state: BaselineState): PolicyBearingNode[] {
  const pov = POV_KEYS.filter(k => dirtyKeys.has(k)).flatMap(k => state[k]?.nodes ?? []);
  const situations = dirtyKeys.has('situations') ? (state.situations?.nodes ?? []) : [];
  return [...pov, ...situations] as PolicyBearingNode[];
}

/** Every loaded node in the four files the registry counts across (PowerShell's PolicyPovFiles). */
export function allPolicyNodes(state: BaselineState): PolicyBearingNode[] {
  return [...POV_KEYS.flatMap(k => state[k]?.nodes ?? []), ...(state.situations?.nodes ?? [])] as PolicyBearingNode[];
}

/** After a successful save, the saved files become the gates' new baselines. */
export function baselineAfterSave(dirtyKeys: Set<string>, state: BaselineState): Partial<Pick<TaxonomyDataSlice, 'situationsBaseline' | 'povTagsBaseline' | 'policyIdsBaseline'>> {
  const out: Partial<Pick<TaxonomyDataSlice, 'situationsBaseline' | 'povTagsBaseline' | 'policyIdsBaseline'>> = {};
  if (dirtyKeys.has('situations') && state.situations) out.situationsBaseline = buildSituationBaseline(state.situations.nodes);
  const savedPovNodes = POV_KEYS.filter(k => dirtyKeys.has(k)).flatMap(k => state[k]?.nodes ?? []);
  if (savedPovNodes.length > 0) out.povTagsBaseline = { ...state.povTagsBaseline, ...buildPovTagBaseline(savedPovNodes) };
  const policyNodes = savedPolicyNodes(dirtyKeys, state);
  if (policyNodes.length > 0) {
    // Rebuild from everything loaded, so a node deleted in this save drops out of the baseline.
    out.policyIdsBaseline = buildPolicyIdBaseline(allPolicyNodes(state));
  }
  return out;
}
