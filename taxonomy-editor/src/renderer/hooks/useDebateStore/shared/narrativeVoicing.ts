// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Renderer wiring for the h3 opening narrative voicing. The app orchestrates debates in
// the renderer (never the lib DebateEngine — t/1779), so this mirrors
// lib/debate/debateEngine/phases/narrativeVoicing.ts over the store's get/set.

import type { DebateSession, NarrativeVoicing, SpeakerId, TranscriptEntry } from '../../../types/debate';
import { POVER_INFO, AI_POVERS } from '../../../types/debate';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { narrativeVoicingPrompt } from '@lib/debate/prompts';
import {
  NARRATIVE_VOICING_KIND,
  parseNarrativeVoicing,
  formatNarrativeVoicingEntry,
  truncateNarrativeMaterial,
  embedNarrativeReferences,
  scoreTurnAgainstNarrative,
  extractNarrativeCheck,
  type EmbedTextsFn,
} from '@lib/debate/narrativeVoicing';
import { formatTaxonomyContext } from '../../../utils/taxonomyContext';
import { getRelevantTaxonomyContext } from './taxonomyContext';
import { generateTextWithProgress } from './generation';
import { recordDiagnostic, pushWarning } from './diagnostics';
import { isCancellationError } from './guards';

type Get = () => { activeDebate: DebateSession | null };
type Set = (partial: Record<string, unknown>) => void;
type AddEntry = (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => string;
type PoverId = Exclude<SpeakerId, 'user'>;

const VOICING_SKIPPED = 'Moderator narrative voicing could not be generated — openings ran without it';

const embedTexts: EmbedTextsFn = async texts => (await api.computeEmbeddings(texts)).vectors;

function errorInfo(err: unknown): { name: string; message: string; stack?: string } {
  return { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack };
}

/** Re-read state and replace narrative_voicing immutably (awaits may have interleaved other writes). */
function patchVoicing(get: Get, set: Set, fn: (v: NarrativeVoicing) => NarrativeVoicing): void {
  const d = get().activeDebate;
  if (!d?.narrative_voicing) return;
  set({ activeDebate: { ...d, narrative_voicing: fn(d.narrative_voicing) } });
}

/**
 * Moderator voices each camp's story before the openings. No-op unless the debate was
 * created with narrative voicing on, or if it already ran (resume). Failure → WARN and the
 * openings proceed without it.
 */
export async function runNarrativeVoicing(get: Get, set: Set, addTranscriptEntry: AddEntry, model: string): Promise<void> {
  const debate = get().activeDebate;
  if (!debate?.narrative_voicing_enabled || debate.narrative_voicing) return;
  const povers = debate.active_povers.filter((p): p is PoverId => (AI_POVERS as readonly string[]).includes(p));
  if (povers.length === 0) return;

  const moderatorModel = debate.stage_models?.moderator || model;
  try {
    const materials = [];
    for (const p of povers) {
      const info = POVER_INFO[p];
      const ctx = await getRelevantTaxonomyContext(info.pov, debate.topic.final, '');
      materials.push({ pov: info.pov, label: info.label, context: truncateNarrativeMaterial(formatTaxonomyContext(ctx, info.pov)) });
    }
    const prompt = narrativeVoicingPrompt(debate.topic.final, materials, debate.topic.background || undefined);
    const { text } = await generateTextWithProgress(prompt, moderatorModel, 'Moderator is voicing each camp\'s story', set);
    const narratives = parseNarrativeVoicing(text, povers);
    if (!narratives) { // parseNarrativeVoicing already logged the WARN
      pushWarning(get, set, VOICING_SKIPPED);
      return;
    }

    const entryId = addTranscriptEntry({
      type: 'system',
      speaker: 'moderator',
      content: formatNarrativeVoicingEntry(narratives),
      taxonomy_refs: [],
      metadata: { kind: NARRATIVE_VOICING_KIND },
    });
    recordDiagnostic(get, set, entryId, { prompt, raw_response: text, model: moderatorModel });
    const fresh = get().activeDebate;
    if (fresh) set({ activeDebate: { ...fresh, narrative_voicing: { entry_id: entryId, model: moderatorModel, narratives } } });
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', debate_id: get().activeDebate?.id, message: 'Narrative voicing failed — openings proceed without it', error: errorInfo(err) });
    if (!isCancellationError(err)) pushWarning(get, set, VOICING_SKIPPED);
  }
}

/** Record a debater's affirm/amend check of its own camp's narrative from its opening DRAFT. */
export function recordNarrativeCheck(get: Get, set: Set, speaker: PoverId, draft: Record<string, unknown> | undefined): void {
  if (!get().activeDebate?.narrative_voicing?.narratives.some(n => n.speaker === speaker)) return;
  const acknowledgment = extractNarrativeCheck(draft);
  if (!acknowledgment) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', debate_id: get().activeDebate?.id, message: `${POVER_INFO[speaker].label} opening returned no usable narrative_check — narrative reference uses the moderator's account unamended`, data: { speaker, narrative_check: draft?.narrative_check ?? null } });
    return;
  }
  patchVoicing(get, set, v => ({
    ...v,
    narratives: v.narratives.map(n => n.speaker === speaker ? { ...n, acknowledgment } : n),
  }));
}

async function scoreEntry(get: Get, set: Set, entryId: string, speaker: string, content: string): Promise<void> {
  const voicing = get().activeDebate?.narrative_voicing;
  if (!voicing) return;
  const sim = await scoreTurnAgainstNarrative(voicing.narratives, speaker, content, embedTexts);
  if (sim === null) return;
  patchVoicing(get, set, v => ({ ...v, similarity_series: { ...v.similarity_series, [entryId]: sim } }));
}

/** After the openings: embed each camp's narrative as its drift reference and score the openings. */
export async function finalizeNarrativeReference(get: Get, set: Set): Promise<void> {
  const voicing = get().activeDebate?.narrative_voicing;
  if (!voicing) return;
  try {
    const embedded = voicing.narratives.map(n => ({ ...n }));
    await embedNarrativeReferences(embedded, embedTexts);
    // Merge by speaker so the patch carries only embeddings, never stale copies of other fields.
    const bySpeaker = new Map(embedded.map(n => [n.speaker, n.embedding]));
    patchVoicing(get, set, v => ({ ...v, narratives: v.narratives.map(n => ({ ...n, embedding: bySpeaker.get(n.speaker) ?? n.embedding })) }));
    const openings = (get().activeDebate?.transcript ?? []).filter(e => e.type === 'opening' && e.content);
    for (const e of openings) await scoreEntry(get, set, e.id, e.speaker, e.content);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', debate_id: get().activeDebate?.id, message: 'Narrative reference embedding failed — narrative drift series will be absent', error: errorInfo(err) });
  }
}

/** Score one cross-respond statement against its speaker's camp narrative. Non-blocking. */
export async function updateNarrativeSimilarity(get: Get, set: Set, entryId: string, speaker: string, content: string): Promise<void> {
  try {
    await scoreEntry(get, set, entryId, speaker, content);
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-store', level: 'warn', debate_id: get().activeDebate?.id, message: 'Narrative similarity update failed', error: errorInfo(err) });
  }
}
