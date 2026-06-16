// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import type { SpeakerId } from '../../../types/debate';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { extractClaimsAndUpdateAN, pushWarning } from '../helpers';

export interface ArgumentNetworkSlice {
  updateAnNodeSubScore: (nodeId: string, key: string, value: number) => void;
  reExtractClaims: (entryId: string) => Promise<void>;
}

export const createArgumentNetworkSlice: StateCreator<DebateStore, [], [], ArgumentNetworkSlice> = (set, get) => ({
  updateAnNodeSubScore: (nodeId: string, key: string, value: number) => {
    const debate = get().activeDebate;
    if (!debate?.argument_network) return;
    const nodes = debate.argument_network.nodes.map(n => {
      if (n.id !== nodeId || !n.bdi_sub_scores) return n;
      const updated = { ...n.bdi_sub_scores, [key]: value };
      const vals = Object.values(updated).filter((v): v is number => v != null);
      const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : n.base_strength;
      return { ...n, bdi_sub_scores: updated, base_strength: avg };
    });
    set({
      activeDebate: {
        ...debate,
        argument_network: { ...debate.argument_network, nodes },
      },
    });
  },

  reExtractClaims: async (entryId: string) => {
    const debate = get().activeDebate;
    if (!debate) return;
    const entry = debate.transcript.find(e => e.id === entryId);
    if (!entry || (entry.type !== 'statement' && entry.type !== 'opening')) return;
    const statement = typeof entry.content === 'string' ? entry.content : '';
    if (!statement) return;
    const speaker = entry.speaker as SpeakerId;
    const taxonomyRefIds = (entry.taxonomy_refs ?? []).map(r => r.node_id);
    const myClaims = (entry.metadata as Record<string, unknown> | undefined)?.my_claims as { claim: string; targets: string[] }[] | undefined;
    try {
      await extractClaimsAndUpdateAN(statement, speaker, entryId, taxonomyRefIds, get, set, myClaims);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: debate.id,
        component: 'debate-store',
        level: 'error',
        message: `Re-extraction failed for entry ${entryId}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      pushWarning(get, set, `Re-extraction failed: ${mapErrorToUserMessage(err)}`);
    }
  },
});
