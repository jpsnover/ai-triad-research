// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type {
  CruxRegistry,
  CruxRegistryEntry,
  CruxOccurrence,
  CruxResolutionState,
  TrackedCrux,
  DebateSession,
  ArgumentNetworkNode,
} from './types.js';
import { cosineSimilarity } from './taxonomyRelevance.js';
import { nowISO, parseJsonRobust } from './helpers.js';
import { decontextualizeCruxPrompt } from './prompts.js';

export type EmbedFn = (text: string) => Promise<number[]>;
export type GenerateFn = (prompt: string) => Promise<string>;

const REGISTRY_FILE = 'crux-registry.json';
const DEDUP_THRESHOLD = 0.80;
const SEED_THRESHOLD = 0.50;
const MAX_ENTRIES = 200;
const STALENESS_MONTHS = 12;

export function registryPath(dataRoot: string): string {
  return path.join(dataRoot, 'calibration', REGISTRY_FILE);
}

export function loadRegistry(dataRoot: string): CruxRegistry {
  const p = registryPath(dataRoot);
  if (!fs.existsSync(p)) {
    return { version: 1, entries: [], last_updated: nowISO() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (raw && Array.isArray(raw.entries)) return raw as CruxRegistry;
    return { version: 1, entries: [], last_updated: nowISO() };
  } catch {
    return { version: 1, entries: [], last_updated: nowISO() };
  }
}

export function saveRegistry(registry: CruxRegistry, dataRoot: string): void {
  const calibDir = path.join(dataRoot, 'calibration');
  if (!fs.existsSync(calibDir)) {
    fs.mkdirSync(calibDir, { recursive: true });
  }
  registry.last_updated = nowISO();
  fs.writeFileSync(registryPath(dataRoot), JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function normalizeDescription(desc: string): string {
  return desc.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function hashDescription(desc: string): string {
  return createHash('sha256').update(normalizeDescription(desc)).digest('hex').slice(0, 16);
}

function majorityVoteType(
  existing: CruxRegistryEntry['disagreement_type'],
  occurrences: CruxOccurrence[],
  newType?: TrackedCrux['disagreement_type'],
): CruxRegistryEntry['disagreement_type'] {
  const counts: Record<string, number> = { empirical: 0, values: 0, definitional: 0 };
  counts[existing] += 1;
  if (newType) counts[newType] += 1;
  let best = existing;
  let bestCount = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestCount) { bestCount = v; best = k as CruxRegistryEntry['disagreement_type']; }
  }
  return best;
}

function latestOccurrenceDate(entry: CruxRegistryEntry): string {
  if (entry.occurrences.length === 0) return entry.first_seen_date;
  return entry.occurrences.reduce((latest, o) => o.date > latest ? o.date : latest, entry.occurrences[0].date);
}

export function resolveTaxonomyRefs(
  claimIds: string[],
  anNodeMap: Map<string, ArgumentNetworkNode>,
): string[] {
  const refs = new Set<string>();
  for (const claimId of claimIds) {
    const node = anNodeMap.get(claimId);
    if (node?.taxonomy_refs) {
      for (const ref of node.taxonomy_refs) {
        refs.add(typeof ref === 'string' ? ref : (ref as { node_id: string }).node_id);
      }
    }
  }
  return [...refs];
}

export async function persistDebateCruxes(
  session: DebateSession,
  dataRoot: string,
  embedFn: EmbedFn,
  generateFn?: GenerateFn,
): Promise<{ merged: number; created: number }> {
  const cruxes = (session.crux_tracker ?? []).filter(
    c => c.state === 'irreducible' || c.state === 'engaged',
  );
  if (cruxes.length === 0) return { merged: 0, created: 0 };

  const registry = loadRegistry(dataRoot);
  let merged = 0;
  let created = 0;
  const model = session.debate_model ?? 'unknown';
  const debateTopic = (session.title ?? session.id).slice(0, 200);
  const transcript = session.transcript ?? [];

  const anNodes = session.argument_network?.nodes ?? [];
  const anNodeMap = new Map(anNodes.map(n => [n.id, n]));

  for (const crux of cruxes) {
    let description = crux.description;

    if (generateFn) {
      try {
        const surroundingTurns = transcript
          .filter(e => e.type === 'statement')
          .filter(e => {
            const turn = (e.metadata as Record<string, unknown>)?.turn_number as number | undefined;
            return turn != null && Math.abs(turn - crux.identified_turn) <= 1;
          })
          .slice(-3)
          .map(e => `${e.speaker}: ${e.content.slice(0, 300)}`);

        const prompt = decontextualizeCruxPrompt(
          crux.description,
          debateTopic,
          crux.speakers_involved,
          surroundingTurns,
        );
        const raw = await generateFn(prompt);
        const result = parseJsonRobust(raw) as { decontextualized?: string };
        if (result.decontextualized && result.decontextualized.length > 0) {
          description = result.decontextualized;
        }
      } catch {
        // Decontextualization failure is non-blocking — use original description
      }
    }

    const embedding = await embedFn(description);
    const occurrence: CruxOccurrence = {
      debate_id: session.id,
      debate_topic: (session.title ?? session.id).slice(0, 100),
      date: nowISO(),
      an_id: crux.id,
      final_state: crux.state,
      turns_engaged: crux.history.length,
      intervention_issued: session.moderator_state?.crux_focused_ids?.has(crux.id) ?? false,
      resolved_post_intervention: false,
      model,
    };

    const taxonomyRefs = resolveTaxonomyRefs(crux.attacking_claim_ids, anNodeMap);

    let bestMatch: CruxRegistryEntry | null = null;
    let bestSim = 0;
    for (const entry of registry.entries) {
      if (entry.embedding.length !== embedding.length) continue;
      const sim = cosineSimilarity(entry.embedding, embedding);
      if (sim > bestSim) { bestSim = sim; bestMatch = entry; }
    }

    if (bestMatch && bestSim >= DEDUP_THRESHOLD) {
      bestMatch.occurrences.push(occurrence);
      bestMatch.disagreement_type = majorityVoteType(
        bestMatch.disagreement_type,
        bestMatch.occurrences,
        crux.disagreement_type,
      );
      const newRefs = taxonomyRefs.filter(r => !bestMatch!.related_taxonomy_nodes.includes(r));
      bestMatch.related_taxonomy_nodes.push(...newRefs);
      merged++;
    } else {
      const entry: CruxRegistryEntry = {
        id: hashDescription(description),
        description,
        embedding,
        disagreement_type: crux.disagreement_type ?? 'empirical',
        first_seen_debate: session.id,
        first_seen_date: nowISO(),
        occurrences: [occurrence],
        related_taxonomy_nodes: [...taxonomyRefs],
        promoted_to_situation: null,
      };
      registry.entries.push(entry);
      created++;
    }
  }

  evictStaleEntries(registry);
  saveRegistry(registry, dataRoot);
  return { merged, created };
}

export function evictStaleEntries(registry: CruxRegistry): number {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - STALENESS_MONTHS);
  const cutoffISO = cutoff.toISOString();

  const before = registry.entries.length;

  registry.entries = registry.entries.filter(e => {
    if (e.promoted_to_situation) return true;
    return latestOccurrenceDate(e) >= cutoffISO;
  });

  if (registry.entries.length > MAX_ENTRIES) {
    registry.entries.sort((a, b) => latestOccurrenceDate(b).localeCompare(latestOccurrenceDate(a)));
    registry.entries = registry.entries.slice(0, MAX_ENTRIES);
  }

  return before - registry.entries.length;
}

const MAX_SEEDED_CRUXES = 8;

export function findRelevantPriorCruxes(
  topicEmbedding: number[],
  registry: CruxRegistry,
  maxResults: number = MAX_SEEDED_CRUXES,
): CruxRegistryEntry[] {
  return registry.entries
    .filter(e => {
      if (e.embedding.length !== topicEmbedding.length) return false;
      return cosineSimilarity(e.embedding, topicEmbedding) >= SEED_THRESHOLD;
    })
    .sort((a, b) =>
      cosineSimilarity(b.embedding, topicEmbedding) - cosineSimilarity(a.embedding, topicEmbedding),
    )
    .slice(0, maxResults);
}

export function formatPriorCruxContext(entries: CruxRegistryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = ['=== PRIOR UNRESOLVED CRUXES ==='];
  lines.push('The following cruxes were identified in prior debates on related topics. They are provided for awareness only — do not assume they apply to this debate without evidence.\n');
  for (const e of entries) {
    const count = e.occurrences.length;
    const states = e.occurrences.map(o => o.final_state);
    const irreducibleCount = states.filter(s => s === 'irreducible').length;
    const status = irreducibleCount > 0
      ? `${irreducibleCount}/${count} irreducible`
      : `${count} occurrence${count > 1 ? 's' : ''}, engaged`;
    lines.push(`- [${e.disagreement_type}] "${e.description}" (${status})`);
  }
  return lines.join('\n');
}
