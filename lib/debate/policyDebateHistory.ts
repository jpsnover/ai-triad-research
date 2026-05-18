// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Cross-debate policy impact tracking.
 *
 * Scans all debate sessions and builds an index of how each policy
 * has been affected across debates: cited, strengthened, weakened,
 * or complicated by synthesis outcomes.
 */

import type { TranscriptEntry } from './types.js';

// ── Types ────────────────────────────────────────────────

export interface PolicyDebateRecord {
  debate_id: string;
  topic: string;
  date: string;
  verdict: 'strengthened' | 'weakened' | 'complicated' | 'neutral';
  cited_by: string[];  // debater names who cited this policy
  key_argument?: string;  // most decisive argument affecting this policy
}

export interface PolicyHistory {
  policy_id: string;
  action: string;
  debates: PolicyDebateRecord[];
  trend: 'consistently_strengthened' | 'consistently_weakened' | 'contested' | 'underexplored';
  total_citations: number;
}

export type PolicyDebateIndex = Record<string, PolicyHistory>;

// ── Index builder ────────────────────────────────────────

/**
 * Build the policy debate history index from a set of debate sessions.
 *
 * @param sessions - Array of debate session objects (with transcript, synthesis, policy_refs)
 * @param policyRegistry - Array of { id, action } from policy_actions.json
 */
export function buildPolicyDebateIndex(
  sessions: Array<{
    id: string;
    topic: string;
    created_at?: string;
    transcript: TranscriptEntry[];
    synthesis?: Record<string, unknown>;
  }>,
  policyRegistry: Array<{ id: string; action: string }>,
): PolicyDebateIndex {
  const index: PolicyDebateIndex = {};

  // Initialize index entries for all policies
  for (const pol of policyRegistry) {
    index[pol.id] = {
      policy_id: pol.id,
      action: pol.action,
      debates: [],
      trend: 'underexplored',
      total_citations: 0,
    };
  }

  for (const session of sessions) {
    // Collect all policy_refs from transcript entries
    const citedPolicies = new Map<string, Set<string>>(); // policy_id → set of speakers

    for (const entry of session.transcript) {
      const refs = entry.policy_refs ?? [];
      for (const ref of refs) {
        const pid = typeof ref === 'string' ? ref : ref.policy_id;
        if (!pid) continue;
        if (!citedPolicies.has(pid)) citedPolicies.set(pid, new Set());
        citedPolicies.get(pid)!.add(entry.speaker);
      }
    }

    // Extract synthesis policy_implications if available
    const synthImplications = (session.synthesis?.policy_implications ?? []) as Array<{
      policy_refs?: string[];
      disagreement?: string;
      implication?: string;
    }>;

    const synthPolicyVerdicts = new Map<string, string>(); // policy_id → implication text
    for (const imp of synthImplications) {
      for (const pid of imp.policy_refs ?? []) {
        synthPolicyVerdicts.set(pid, imp.implication ?? '');
      }
    }

    // Build records for each cited policy
    for (const [pid, speakers] of citedPolicies) {
      if (!index[pid]) continue;

      const implication = synthPolicyVerdicts.get(pid) ?? '';
      const verdict = classifyVerdict(implication);

      index[pid].debates.push({
        debate_id: session.id,
        topic: session.topic,
        date: session.created_at ?? '',
        verdict,
        cited_by: [...speakers],
        key_argument: implication || undefined,
      });
      index[pid].total_citations += speakers.size;
    }
  }

  // Compute trends
  for (const history of Object.values(index)) {
    history.trend = computeTrend(history.debates);
  }

  return index;
}

// ── Helpers ──────────────────────────────────────────────

function classifyVerdict(implication: string): PolicyDebateRecord['verdict'] {
  if (!implication) return 'neutral';
  const lower = implication.toLowerCase();
  if (/strengthen|support|reinforc|validat|confirm/.test(lower)) return 'strengthened';
  if (/weaken|undermin|challeng|refut|contra/.test(lower)) return 'weakened';
  if (/complic|nuanc|qualif|condition|depend/.test(lower)) return 'complicated';
  return 'neutral';
}

function computeTrend(debates: PolicyDebateRecord[]): PolicyHistory['trend'] {
  if (debates.length === 0) return 'underexplored';
  if (debates.length === 1) return 'underexplored';

  const verdicts = debates.map(d => d.verdict).filter(v => v !== 'neutral');
  if (verdicts.length === 0) return 'underexplored';

  const strengthened = verdicts.filter(v => v === 'strengthened').length;
  const weakened = verdicts.filter(v => v === 'weakened').length;
  const total = verdicts.length;

  if (strengthened / total >= 0.7) return 'consistently_strengthened';
  if (weakened / total >= 0.7) return 'consistently_weakened';
  return 'contested';
}
