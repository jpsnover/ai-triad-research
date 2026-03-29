#!/usr/bin/env node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Phase 6b — Deterministic fallacy tier backfill.
 * Maps every possible_fallacies entry to its tier using a lookup table.
 * No AI calls needed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '..', '..', 'ai-triad-data');
const TAXONOMY_DIR = path.join(DATA_ROOT, 'taxonomy', 'Origin');

const TIER_MAP = {
  // Formal fallacies
  affirming_the_consequent: 'formal',
  denying_the_antecedent: 'formal',
  affirming_a_disjunct: 'formal',
  undistributed_middle: 'formal',

  // Informal structural — structurally flawed regardless of content
  begging_the_question: 'informal_structural',
  circular_reasoning: 'informal_structural',
  false_dilemma: 'informal_structural',
  false_equivalence: 'informal_structural',
  straw_man: 'informal_structural',
  red_herring: 'informal_structural',
  slippery_slope: 'informal_structural',
  composition_division: 'informal_structural',
  continuum_fallacy: 'informal_structural',
  equivocation: 'informal_structural',
  loaded_question: 'informal_structural',
  moving_the_goalposts: 'informal_structural',
  no_true_scotsman: 'informal_structural',
  reification: 'informal_structural',
  special_pleading: 'informal_structural',
  tu_quoque: 'informal_structural',
  reductio_ad_absurdum: 'informal_structural',

  // Informal contextual — depends on context
  ad_hominem: 'informal_contextual',
  appeal_to_authority: 'informal_contextual',
  appeal_to_consequences: 'informal_contextual',
  appeal_to_emotion: 'informal_contextual',
  appeal_to_fear: 'informal_contextual',
  appeal_to_nature: 'informal_contextual',
  appeal_to_novelty: 'informal_contextual',
  appeal_to_popularity: 'informal_contextual',
  appeal_to_tradition: 'informal_contextual',
  argument_from_analogy: 'informal_contextual',
  argument_from_ignorance: 'informal_contextual',
  argument_from_incredulity: 'informal_contextual',
  argument_from_silence: 'informal_contextual',
  bandwagon_fallacy: 'informal_contextual',
  burden_of_proof: 'informal_contextual',
  cherry_picking: 'informal_contextual',
  correlation_causation: 'informal_contextual',
  false_cause: 'informal_contextual',
  gambler_fallacy: 'informal_contextual',
  genetic_fallacy: 'informal_contextual',
  guilt_by_association: 'informal_contextual',
  hasty_generalization: 'informal_contextual',
  is_ought_problem: 'informal_contextual',
  middle_ground: 'informal_contextual',
  moralistic_fallacy: 'informal_contextual',
  naturalistic_fallacy: 'informal_contextual',
  nirvana_fallacy: 'informal_contextual',
  sunk_cost: 'informal_contextual',
  texas_sharpshooter: 'informal_contextual',
  unfalsifiability: 'informal_contextual',

  // Cognitive biases
  base_rate_neglect: 'cognitive_bias',
  anchoring_bias: 'cognitive_bias',
  availability_heuristic: 'cognitive_bias',
  confirmation_bias: 'cognitive_bias',
  dunning_kruger: 'cognitive_bias',
  hindsight_bias: 'cognitive_bias',
  optimism_bias: 'cognitive_bias',
  status_quo_bias: 'cognitive_bias',
  survivorship_bias: 'cognitive_bias',
  // Edge case: rhetorical strategy that appeared in fallacy arrays
  techno_optimism: 'cognitive_bias',
};

function main() {
  const files = ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'cross-cutting.json'];
  let totalEntries = 0, mapped = 0, unknown = 0;
  const unknownKeys = new Set();

  for (const f of files) {
    const filePath = path.join(TAXONOMY_DIR, f);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    for (const node of data.nodes) {
      const fallacies = node.graph_attributes?.possible_fallacies;
      if (!fallacies || !Array.isArray(fallacies)) continue;

      for (const entry of fallacies) {
        totalEntries++;
        const normalizedKey = entry.fallacy.toLowerCase();
        const tier = TIER_MAP[normalizedKey];
        if (tier) {
          entry.type = tier;
          mapped++;
        } else {
          unknownKeys.add(entry.fallacy);
          unknown++;
        }
      }
    }

    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  console.log('Phase 6b — Fallacy Tier Backfill');
  console.log(`  Total entries: ${totalEntries}`);
  console.log(`  Mapped: ${mapped}`);
  console.log(`  Unknown: ${unknown}`);
  if (unknownKeys.size > 0) console.log(`  Unknown keys: ${[...unknownKeys].join(', ')}`);
  console.log(`  Coverage: ${(mapped / totalEntries * 100).toFixed(1)}%`);
}

main();
