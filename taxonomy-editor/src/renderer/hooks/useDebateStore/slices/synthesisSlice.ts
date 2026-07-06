// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { StateCreator } from 'zustand';
import type { DebateStore } from '../types';
import { buildProbingQuestionsPrompt, buildFactCheckPrompt, buildContextCompressionPrompt } from '../shared/prompts';
import type {
  DebateSession,
  SpeakerId,
  TranscriptEntry,
} from '../../../types/debate';
import { POVER_INFO, AI_POVERS, POV_KEYS } from '../../../types/debate';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { trackDebateComplete } from '../../../lib/analyticsEmitter';
import { generateId, nowISO, stripCodeFences, parseAIJson, extractArraysFromPartialJson, formatRecentTranscript } from '@lib/debate/helpers';
import { runSynthesisPhases } from '@lib/debate/synthesisPhases';
import type { SynthesisInput } from '@lib/debate/synthesisPhases';
import { formatTaxonomyContext } from '../../../utils/taxonomyContext';
import { formatCommitments, formatEstablishedPoints, formatConcessionCandidatesHint } from '../../../prompts/argumentNetwork';
import { formatVocabularyContext } from '@lib/debate/vocabularyContext';
import { concludingPrompt, entrySummarizationPrompt, missingArgumentsPrompt, taxonomyRefinementPrompt, crossCuttingNodePrompt } from '../../../prompts/debate';
import { computeQbafStrengths } from '@lib/debate/qbaf';
import type { QbafNode, QbafEdge } from '@lib/debate/qbaf';
import { factCheckToBaseStrength } from '@lib/debate/argumentNetwork';
import { updateConvergenceTracker } from '../../../utils/convergenceScoring';
import { computeConvergenceSignals } from '@lib/debate/convergenceSignals';
import { computeProcessReward } from '@lib/debate/processReward';
import type { ProcessRewardEntry } from '@lib/debate/types';
import { computeTaxonomyGapAnalysis } from '@lib/debate/taxonomyGapAnalysis';
import { computeBeliefConfidence } from '@lib/debate/beliefConfidence';
import { computeTreePriority } from '@lib/debate/desirePriority';
import { computeOperationality } from '@lib/debate/intentionOperationality';
import { useTaxonomyStore } from '../../useTaxonomyStore';
import { mapErrorToUserMessage } from '../../../utils/errorMessages';
import { getConfiguredModel } from '../shared/modelConfig';
import { generateTextWithProgress, phaseGuardedSet } from '../shared/generation';
import { createDebateGuard, newAbortController, _abortController, isDailyLimitError, DAILY_LIMIT_MESSAGE } from '../shared/guards';
import { pushWarning, recordDiagnostic } from '../shared/diagnostics';
import { runNeutralCheckpoint } from '../shared/neutralCheckpoint';
import { getRelevantTaxonomyContext, formatDebaterEdgeContext, enrichPolicyRefs, serializeNodeSourceMap, getNodeLabelForFactCheck, getTaxonomyContext } from '../shared/taxonomyContext';
import { commitAnNodes } from '../shared/argumentNetwork';

export interface SynthesisSlice {
  requestSynthesis: () => Promise<void>;
  requestProbingQuestions: () => Promise<void>;
  factCheckSelection: (selectedText: string, entryId: string) => Promise<void>;
  compressOldTranscript: () => Promise<void>;
  generateNewsReport: () => Promise<void>;
}

export const createSynthesisSlice: StateCreator<DebateStore, [], [], SynthesisSlice> = (set, get) => ({
  requestSynthesis: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    newAbortController();
    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });
    getGlobalRecorder()?.record({ type: 'debate.phase', component: 'debate-store', level: 'info', debate_id: activeDebate.id, message: 'Phase: concluding', data: { phase: 'concluding' } });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';

    const policyRegistry = useTaxonomyStore.getState().policyRegistry ?? [];
    const policyLines = policyRegistry.length > 0
      ? policyRegistry.slice(0, 10).map(p => `${p.id}: ${p.action}`)
      : undefined;

    const synthInput: SynthesisInput = {
      topic: activeDebate.topic.final,
      transcript: fullTranscript,
      audience: activeDebate.audience,
      cruxTracker: activeDebate.crux_tracker,
      policyLines,
      hasSourceDoc,
    };

    try {
      const result = await runSynthesisPhases(
        synthInput,
        async (prompt, label) => {
          const { text } = await generateTextWithProgress(prompt, model, `${label} (${model})`, set, 180_000);
          if (!isStillValid()) throw new Error('Debate changed during synthesis');
          return text;
        },
        (_phase, label) => set({ debateActivity: label }),
        (context, problem, nextStep) => {
          getGlobalRecorder()?.record({
            type: 'system.error',
            component: 'debate-store',
            level: 'warn',
            debate_id: activeDebate.id,
            message: `Synthesis warning: ${context} — ${problem}`,
            data: { nextStep },
          });
          pushWarning(get, set, `${context}: ${problem}`);
        },
        () => { if (!isStillValid()) throw new Error('Debate changed during synthesis'); },
      );

      const synthesis: any = result.data;
      const synthElapsedMs = result.elapsed_ms;

      getGlobalRecorder()?.record({
        type: 'ai.response',
        component: 'debate-store',
        level: 'info',
        debate_id: activeDebate.id,
        message: 'Synthesis parsed (3-phase pipeline)',
        data: {
          model,
          parse_method: '3-phase',
          schema: Object.fromEntries(
            Object.entries(synthesis).map(([k, v]) => [k,
              v === null ? 'null' : Array.isArray(v) ? `array(${(v as unknown[]).length})` : typeof v]),
          ),
        },
      });

      // Build readable content
      // Strip inline node IDs from text fields — they belong in taxonomy_refs, not prose
      const stripNodeIds = (text: unknown): string => {
        const s = typeof text === 'string' ? text : String(text ?? '');
        return s.replace(/\b(?:acc|saf|skp|sit|cc)-(?:beliefs|desires|intentions)-\d+\b/g, '')
                .replace(/\s{2,}/g, ' ').trim();
      };

      const lines: string[] = [];
      if (synthesis._raw_text) {
        lines.push('*Synthesis could not be parsed as structured data. Raw output:*');
        lines.push('');
        // Break raw text into readable paragraphs at sentence boundaries and bullet markers
        const formatted = synthesis._raw_text
          .replace(/([.!?])\s+(?=[A-Z"*-])/g, '$1\n\n')  // paragraph break at sentence ends before capitals
          .replace(/\s*[-–—•]\s+/g, '\n- ')               // normalize bullet-like markers
          .replace(/\s*\d+\.\s+/g, (m: string) => '\n' + m.trim() + ' '); // numbered lists
        lines.push(formatted);
      }
      if (synthesis.areas_of_agreement?.length > 0) {
        lines.push('## Areas of Agreement', '');
        for (const a of synthesis.areas_of_agreement) {
          const who = Array.isArray(a.povers) ? a.povers.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ') : '';
          lines.push(`- ${stripNodeIds(a.point)}${who ? ` (${who})` : ''}`);
        }
      }
      if (synthesis.areas_of_disagreement?.length > 0) {
        lines.push('', '## Areas of Disagreement', '');
        for (const d of synthesis.areas_of_disagreement) {
          const typeTag = d.type ? ` [${d.type}]` : '';
          const bdiTag = d.bdi_layer ? ` {${d.bdi_layer}}` : '';
          lines.push(`- **${stripNodeIds(d.point)}**${typeTag}${bdiTag}`);
          if (d.resolvability) {
            lines.push(`  - *Resolution path: ${d.resolvability.replace(/_/g, ' ')}*`);
          }
          if (Array.isArray(d.positions)) {
            for (const pos of d.positions) {
              const label = POVER_INFO[pos.pover as Exclude<SpeakerId, 'user'>]?.label || pos.pover;
              lines.push(`  - ${label}: ${stripNodeIds(pos.stance)}`);
            }
          }
        }
      }
      if (synthesis.cruxes?.length > 0) {
        lines.push('', '## Cruxes', '');
        for (const c of synthesis.cruxes) {
          const typeTag = c.type ? ` [${c.type}]` : '';
          lines.push(`- ${stripNodeIds(c.question)}${typeTag}`);
          if (c.if_yes) lines.push(`  - If yes: ${stripNodeIds(c.if_yes)}`);
          if (c.if_no) lines.push(`  - If no: ${stripNodeIds(c.if_no)}`);
        }
      }
      if (synthesis.document_claims?.length > 0) {
        lines.push('', '## Document Claims', '');
        for (const dc of synthesis.document_claims) {
          const accepted = Array.isArray(dc.accepted_by)
            ? dc.accepted_by.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ')
            : '';
          const challenged = Array.isArray(dc.challenged_by)
            ? dc.challenged_by.map((p: string) => POVER_INFO[p as Exclude<SpeakerId, 'user'>]?.label || p).join(', ')
            : '';
          lines.push(`- ${stripNodeIds(dc.claim)}`);
          if (accepted) lines.push(`  - Accepted by: ${accepted}`);
          if (challenged) lines.push(`  - Challenged by: ${challenged}${dc.challenge_basis ? ` — ${stripNodeIds(dc.challenge_basis)}` : ''}`);
        }
      }
      if (synthesis.preferences?.length > 0) {
        lines.push('', '## Resolution Analysis', '');
        for (const p of synthesis.preferences) {
          if (p.prevails === 'undecidable') {
            lines.push(`- **${stripNodeIds(p.conflict)}** — Undecidable`);
            lines.push(`  - *${stripNodeIds(p.rationale)}*`);
          } else {
            let prevailsText = p.prevails;
            if (/^C\d+$/.test(p.prevails) && synthesis.argument_map) {
              const claim = synthesis.argument_map.find((c: { claim_id: string; claim: string; claimant: string }) => c.claim_id === p.prevails);
              if (claim) prevailsText = `${claim.claimant}: "${stripNodeIds(claim.claim)}"`;
            }
            lines.push(`- **${stripNodeIds(p.conflict)}** — Stronger: ${prevailsText} (${p.criterion?.replace(/_/g, ' ')})`);
            lines.push(`  - *${stripNodeIds(p.rationale)}*`);
          }
          if (p.what_would_change_this) {
            lines.push(`  - Would change if: ${stripNodeIds(p.what_would_change_this)}`);
          }
        }
      }
      if (synthesis.unresolved_questions?.length > 0) {
        lines.push('', '## Unresolved Questions', '');
        for (const q of synthesis.unresolved_questions) {
          lines.push(`- ${stripNodeIds(q)}`);
        }
      }
      if (synthesis.argument_map?.length > 0) {
        lines.push('', '## Argument Map', '');
        for (const claim of synthesis.argument_map) {
          const claimantLabel = POVER_INFO[claim.claimant as Exclude<SpeakerId, 'user'>]?.label || claim.claimant;
          const typeTag = claim.type ? ` [${claim.type}]` : '';
          lines.push(`- **${claim.claim_id}** (${claimantLabel})${typeTag}: ${stripNodeIds(claim.claim)}`);
          if (claim.supported_by?.length > 0) {
            for (const sup of claim.supported_by) {
              if (typeof sup === 'string') {
                lines.push(`  - Supported by: ${sup}`);
              } else {
                const schemeTag = sup.scheme ? ` (${sup.scheme.replace(/_/g, ' ')})` : '';
                lines.push(`  - Supported by ${sup.claim_id}${schemeTag}${sup.warrant ? `: ${stripNodeIds(sup.warrant)}` : ''}`);
              }
            }
          }
          if (claim.attacked_by?.length > 0) {
            for (const attack of claim.attacked_by) {
              const attackerLabel = POVER_INFO[attack.claimant as Exclude<SpeakerId, 'user'>]?.label || attack.claimant;
              const schemeTag = attack.scheme ? ` via ${attack.scheme}` : '';
              lines.push(`  - ← **${attack.claim_id}** ${attack.attack_type}${schemeTag} (${attackerLabel}): ${stripNodeIds(attack.claim)}`);
            }
          }
        }
      }

      const taxonomyCoverage: TaxonomyRef[] = (synthesis.taxonomy_coverage || [])
        .filter((t: Record<string, unknown>) => t.node_id)
        .map((t: Record<string, unknown>) => ({ node_id: t.node_id as string, relevance: (t.how_used as string) || '' }));

      const synthEntryId = addTranscriptEntry({
        type: 'concluding',
        speaker: 'system',
        content: lines.join('\n'),
        taxonomy_refs: taxonomyCoverage,
        metadata: { synthesis },
      });

      recordDiagnostic(get, set, synthEntryId, {
        prompt: '(3-phase synthesis pipeline — see raw_response for per-phase output)',
        raw_response: JSON.stringify(result.rawResponses),
        model,
        response_time_ms: synthElapsedMs,
      });

      // Missing arguments pass — fire after synthesis, non-blocking
      try {
        const synthText = lines.join('\n').slice(0, 4000);
        const summaryLines: string[] = [];
        for (const pov of POV_KEYS) {
          const ctx = getTaxonomyContext(pov);
          for (const n of ctx.povNodes) {
            summaryLines.push(`[${n.id}] ${n.label} (${n.category ?? 'unknown'}) — ${pov}`);
          }
        }
        const maPrompt = missingArgumentsPrompt(
          activeDebate.topic.final,
          summaryLines.slice(0, 80).join('\n'),
          synthText,
          activeDebate.audience,
        );
        const { text: maText } = await api.generateText(maPrompt, model);
        const maParsed = parseAIJson<{ missing_arguments?: unknown[] }>(maText);
        if (maParsed?.missing_arguments && Array.isArray(maParsed.missing_arguments)) {
          const currentDebate = get().activeDebate;
          if (currentDebate) {
            set({ activeDebate: { ...currentDebate, missing_arguments: maParsed.missing_arguments.slice(0, 5) } });
          }
        }
      } catch (maErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Missing arguments detection failed',
          error: { name: (maErr as Error).name ?? 'Error', message: String(maErr), stack: (maErr as Error).stack },
        });
        console.warn('[Missing Args] Pass failed (non-blocking):', maErr);
        pushWarning(get, set, 'Missing argument detection skipped');
      }

      // Taxonomy refinement pass — suggest node revisions based on debate evidence
      try {
        const currentD = get().activeDebate;
        if (currentD) {
          const synthText = lines.join('\n').slice(0, 4000);

          // Collect all referenced node IDs from transcript
          const refIds = new Set<string>();
          for (const entry of currentD.transcript) {
            for (const ref of entry.taxonomy_refs ?? []) {
              refIds.add(ref.node_id);
            }
          }

          if (refIds.size > 0) {
            // Resolve to full node data
            const referencedNodes: { id: string; label: string; pov: string; category: string; description: string }[] = [];
            for (const pov of POV_KEYS) {
              const ctx = getTaxonomyContext(pov);
              for (const n of ctx.povNodes) {
                if (refIds.has(n.id)) {
                  referencedNodes.push({
                    id: n.id,
                    label: n.label,
                    pov,
                    category: n.category ?? 'unknown',
                    description: n.description,
                  });
                }
              }
            }

            if (referencedNodes.length > 0) {
              // Build argument map summary
              const an = currentD.argument_network;
              let anSummary = '(no argument network)';
              if (an && an.nodes.length > 0) {
                const anLines = an.nodes.slice(0, 30).map(n => {
                  const attacks = an.edges.filter(e => e.target === n.id && e.type === 'attacks');
                  const supports = an.edges.filter(e => e.target === n.id && e.type === 'supports');
                  let line = `${n.id} (${n.speaker}): "${n.text}"`;
                  if (attacks.length) line += ` [attacked ${attacks.length}x]`;
                  if (supports.length) line += ` [supported ${supports.length}x]`;
                  return line;
                });
                anSummary = anLines.join('\n');
              }

              const trPrompt = taxonomyRefinementPrompt(
                currentD.topic.final,
                synthText,
                referencedNodes.slice(0, 25),
                anSummary,
                activeDebate.audience,
              );
              const { text: trText } = await api.generateText(trPrompt, model);
              const trParsed = parseAIJson<{ taxonomy_suggestions?: unknown[] }>(trText);
              if (trParsed?.taxonomy_suggestions && Array.isArray(trParsed.taxonomy_suggestions)) {
                const latestD = get().activeDebate;
                if (latestD) {
                  set({ activeDebate: { ...latestD, taxonomy_suggestions: trParsed.taxonomy_suggestions.slice(0, 10) } });
                }
              }
            }
          }
        }
      } catch (trErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Taxonomy refinement pass failed',
          error: { name: (trErr as Error).name ?? 'Error', message: String(trErr), stack: (trErr as Error).stack },
        });
        console.warn('[Taxonomy Refinement] Pass failed (non-blocking):', trErr);
        pushWarning(get, set, 'Taxonomy refinement suggestions skipped');
      }

      // Cross-cutting node promotion — propose situation nodes from 3-way agreements
      try {
        const ccDebate = get().activeDebate;
        const synthEntry = ccDebate?.transcript.find(e => e.type === 'concluding');
        const synthData = (synthEntry?.metadata as Record<string, unknown>)?.synthesis as Record<string, unknown> | undefined;
        const agreements = ((synthData?.areas_of_agreement ?? []) as { point: string; povers?: string[] }[])
          .filter(a => (a.povers?.length ?? 0) >= 3);

        if (agreements.length > 0 && ccDebate) {
          const ccTaxState = useTaxonomyStore.getState();
          const sitLabels = (ccTaxState.situations?.nodes || []).map(n => n.label);
          const ccPrompt = crossCuttingNodePrompt(
            agreements.map(a => ({ point: a.point, povers: a.povers ?? [] })),
            sitLabels,
            ccDebate.topic.final,
          );
          const { text: ccText } = await api.generateText(ccPrompt, model);
          const ccParsed = parseAIJson<{ proposals: CrossCuttingProposal[] }>(ccText);

          if (ccParsed?.proposals?.length) {
            const freshCcDebate = get().activeDebate;
            if (freshCcDebate) {
              set({
                activeDebate: {
                  ...freshCcDebate,
                  cross_cutting_proposals: ccParsed.proposals,
                },
                crossCuttingProposals: ccParsed.proposals,
              });
            }
          }
        }
      } catch (ccErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Cross-cutting proposals detection failed',
          error: { name: (ccErr as Error).name ?? 'Error', message: String(ccErr), stack: (ccErr as Error).stack },
        });
        console.warn('[Cross-Cutting Proposals] Pass failed (non-blocking):', ccErr);
        pushWarning(get, set, 'Cross-cutting proposal detection skipped');
      }

      // Taxonomy gap analysis (deterministic — no LLM calls)
      try {
        const gapDebate = get().activeDebate;
        if (gapDebate) {
          const gapTaxState = useTaxonomyStore.getState();
          const taxonomyNodes: Record<string, { id: string; label: string; category: string; description?: string }[]> = {};
          for (const pov of POV_KEYS) {
            taxonomyNodes[pov] = (gapTaxState[pov]?.nodes || []).map(n => ({
              id: n.id, label: n.label, category: n.category ?? 'unknown', description: n.description,
            }));
          }

          const gapAnalysis = computeTaxonomyGapAnalysis(
            gapDebate.transcript,
            gapDebate.argument_network?.nodes || [],
            taxonomyNodes,
            [],  // Context manifests — TODO: collect during turns
          );

          const freshGapDebate = get().activeDebate;
          if (freshGapDebate) {
            set({
              activeDebate: {
                ...freshGapDebate,
                taxonomy_gap_analysis: gapAnalysis,
              },
              taxonomyGapAnalysis: gapAnalysis,
            });
          }
        }
      } catch (tgaErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Taxonomy gap analysis failed',
          error: { name: (tgaErr as Error).name ?? 'Error', message: String(tgaErr), stack: (tgaErr as Error).stack },
        });
        console.warn('[Taxonomy Gap Analysis] Pass failed (non-blocking):', tgaErr);
        pushWarning(get, set, 'Taxonomy gap analysis skipped');
      }

      // Evidence QBAF — score Belief nodes against source corpus (t/241)
      try {
        const eqDebate = get().activeDebate;
        const eqAN = eqDebate?.argument_network;
        if (eqAN && eqAN.nodes.length > 0) {
          const beliefNodes = eqAN.nodes.filter(
            n => n.bdi_category === 'belief' && n.specificity === 'precise',
          );
          if (beliefNodes.length > 0) {
            const updatedNodes = [...eqAN.nodes];
            let scored = 0;
            for (const node of beliefNodes.slice(0, 5)) {
              try {
                const result = await api.runEvidenceQbaf(node.text, node.id, model);
                if (result && result.evidence_items.length > 0) {
                  const idx = updatedNodes.findIndex(n => n.id === node.id);
                  if (idx >= 0) {
                    updatedNodes[idx] = {
                      ...updatedNodes[idx],
                      base_strength: result.computed_strength,
                      scoring_method: 'evidence_qbaf',
                      verification_status: result.computed_strength >= 0.6 ? 'verified'
                        : result.computed_strength <= 0.4 ? 'disputed' : 'unverifiable',
                      evidence_graph: {
                        evidence_items: result.evidence_items,
                        computed_strength: result.computed_strength,
                        qbaf_iterations: result.qbaf_iterations,
                      },
                    };
                    scored++;
                  }
                }
              } catch (nodeErr) {
                getGlobalRecorder()?.record({
                  type: 'system.error',
                  debate_id: activeDebate?.id,
                  component: 'debate-store',
                  level: 'debug',
                  message: `Evidence QBAF failed for node ${node.id}`,
                  error: { name: (nodeErr as Error).name ?? 'Error', message: String(nodeErr), stack: (nodeErr as Error).stack },
                });
              }
            }
            if (scored > 0 && isStillValid()) {
              const freshEqDebate = get().activeDebate;
              if (freshEqDebate) {
                set({
                  activeDebate: {
                    ...freshEqDebate,
                    argument_network: { ...freshEqDebate.argument_network!, nodes: updatedNodes, edges: freshEqDebate.argument_network!.edges },
                  },
                });
              }
            }
          }
        }
      } catch (eqErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Evidence QBAF pass failed (non-fatal)',
          error: { name: (eqErr as Error).name ?? 'Error', message: String(eqErr), stack: (eqErr as Error).stack },
        });
        pushWarning(get, set, 'Evidence QBAF scoring skipped');
      }

      // Neutral evaluation: final checkpoint (after synthesis) — awaited to prevent
      // phase regression race (t/301): void-ing this allowed updatePhase('closed')
      // to run before the checkpoint's set() call, which then clobbered 'closed' back to 'debate'.
      await runNeutralCheckpoint('final', get, set as any, addTranscriptEntry);

      // Transition phase to closed now that synthesis and all post-synthesis passes are done
      get().updatePhase('closed');
      // Immediate save bypassing auto-save debounce — a hard crash within the debounce
      // window after synthesis would lose the entire synthesis result (t/1140 AC3).
      await saveDebate('synthesis-complete');
      const turnCount = activeDebate?.transcript.filter(e => e.type === 'statement').length ?? 0;
      const durationMs = activeDebate?.created_at ? Date.now() - new Date(activeDebate.created_at).getTime() : 0;
      api.trackEvent('debate_complete', 'debate', { debateId: activeDebate?.id, rounds: turnCount });
      trackDebateComplete(activeDebate?.id, turnCount, durationMs);

      // Emit lineage.debate-summary — aggregates per-turn lineage boost data for quick impact assessment
      try {
        const closedDebate = get().activeDebate;
        if (closedDebate) {
          const allBoosted = new Set<string>();
          const allPromoted = new Set<string>();
          const allInjected = new Set<string>();
          const allReferenced = new Set<string>();
          let turnsWithBoost = 0;

          for (const entry of closedDebate.transcript) {
            if (entry.type !== 'opening' && entry.type !== 'statement') continue;
            const manifest = (entry.metadata as Record<string, unknown>)?.injection_manifest as {
              lineage_boost?: { boostedNodeIds?: string[]; promotedNodeIds?: string[] };
              povNodeIds?: string[];
            } | undefined;
            if (!manifest) continue;

            for (const id of (entry.taxonomy_refs ?? []).map((r: { node_id: string }) => r.node_id)) allReferenced.add(id);
            for (const id of manifest.povNodeIds ?? []) allInjected.add(id);

            const lb = manifest.lineage_boost;
            if (lb) {
              turnsWithBoost++;
              for (const id of lb.boostedNodeIds ?? []) allBoosted.add(id);
              for (const id of lb.promotedNodeIds ?? []) allPromoted.add(id);
            }
          }

          if (allBoosted.size > 0) {
            const promotedCited = [...allPromoted].filter(id => allReferenced.has(id));
            const promotedCitationRate = allPromoted.size > 0 ? promotedCited.length / allPromoted.size : 0;
            const baselineCitationRate = allInjected.size > 0 ? allReferenced.size / allInjected.size : 0;
            const frameLabels = closedDebate.topic?.critique?.lineage_frame?.map(
              (f: { cluster_id: string; label?: string }) => f.label ?? f.cluster_id,
            ) ?? [];

            getGlobalRecorder()?.record({
              type: 'lineage.debate-summary',
              component: 'debate-store',
              level: 'info',
              debate_id: closedDebate.id,
              message: 'Lineage boost debate summary',
              data: {
                lineage_frame: frameLabels,
                turns_with_boost: turnsWithBoost,
                total_boosted: allBoosted.size,
                total_promoted: allPromoted.size,
                promoted_node_ids: [...allPromoted],
                promoted_cited: promotedCited.length,
                promoted_citation_rate: Math.round(promotedCitationRate * 1000) / 1000,
                baseline_citation_rate: Math.round(baselineCitationRate * 1000) / 1000,
                verdict: promotedCitationRate > 0.15 ? 'high_impact' : promotedCitationRate > 0.05 ? 'moderate_impact' : 'low_impact',
              },
            });
          }
        }
      } catch (summaryErr) {
        getGlobalRecorder()?.record({
          type: 'system.error',
          debate_id: activeDebate?.id,
          component: 'debate-store',
          level: 'warn',
          message: 'Lineage debate summary emission failed',
          error: { name: (summaryErr as Error).name ?? 'Error', message: String(summaryErr), stack: (summaryErr as Error).stack },
        });
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'error',
        message: 'Synthesis failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (isDailyLimitError(err)) {
        set({ debateError: DAILY_LIMIT_MESSAGE, dailyLimitPaused: true });
      } else {
        set({ debateError: `Synthesis failed: ${mapErrorToUserMessage(err)}`, debateRetryAction: 'synthesis' });
      }
    } finally {
      set({ debateGenerating: null });
      await saveDebate('requestSynthesis');
    }
  },

  requestProbingQuestions: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);

    // Find taxonomy nodes not yet referenced
    const referencedNodes = new Set<string>();
    for (const entry of activeDebate.transcript) {
      for (const ref of entry.taxonomy_refs) {
        referencedNodes.add(ref.node_id);
      }
    }

    // Gather all taxonomy node IDs from all POVs
    const allNodeIds: string[] = [];
    for (const pov of POV_KEYS) {
      const ctx = getTaxonomyContext(pov);
      for (const n of ctx.povNodes) allNodeIds.push(`[${n.id}] ${n.label}`);
    }
    const ccCtx = getTaxonomyContext('accelerationist'); // situations are the same from any POV
    for (const n of ccCtx.situationNodes) allNodeIds.push(`[${n.id}] ${n.label}`);

    const unreferenced = allNodeIds.filter((desc) => {
      const match = desc.match(/^\[([^\]]+)\]/);
      return match && !referencedNodes.has(match[1]);
    }).slice(0, 20); // Limit to keep prompt reasonable

    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildProbingQuestionsPrompt(activeDebate.topic.final, fullTranscript, unreferenced, hasSourceDoc, activeDebate.audience);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating probing questions (${model})`, set);
      if (!isStillValid()) return;

      type ProbingQ = { text: string; targets: string[] };
      let questions: ProbingQ[] = [];
      const probParsed = parseAIJson<{ questions?: ProbingQ[] } | ProbingQ[]>(text);
      if (probParsed && typeof probParsed === 'object' && 'questions' in probParsed && Array.isArray(probParsed.questions)) {
        questions = probParsed.questions;
      } else if (Array.isArray(probParsed)) {
        questions = probParsed;
      }
      if (questions.length === 0) {
        questions = [{ text: text.trim(), targets: [] }];
      }

      const probingRound = activeDebate.transcript.filter(e => e.type === 'statement').length;
      addTranscriptEntry({
        type: 'probing',
        speaker: 'system',
        content: questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n'),
        taxonomy_refs: [],
        metadata: { probing_questions: questions, round: probingRound },
      });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'error',
        message: 'Probing questions generation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (isDailyLimitError(err)) {
        set({ debateError: DAILY_LIMIT_MESSAGE, dailyLimitPaused: true });
      } else {
        set({ debateError: `Probing questions failed: ${mapErrorToUserMessage(err)}`, debateRetryAction: 'probing' });
      }
    } finally {
      set({ debateGenerating: null });
      await saveDebate('requestProbingQuestions');
    }
  },

  // ── Phase 7: Fact Check ──────────────────────────────────

  factCheckSelection: async (selectedText: string, entryId: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    if (selectedText.length < 10) {
      set({ debateError: 'Select a complete claim to fact-check (at least 10 characters)' });
      return;
    }

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();

    // Find the statement that contains this text
    const sourceEntry = activeDebate.transcript.find((e) => e.id === entryId);
    const statementContext = sourceEntry?.content || selectedText;

    // Gather taxonomy nodes from the statement's refs + general context
    const allNodes: string[] = [];
    if (sourceEntry?.taxonomy_refs) {
      for (const ref of sourceEntry.taxonomy_refs) {
        const label = getNodeLabelForFactCheck(ref.node_id);
        allNodes.push(`[${ref.node_id}] ${label} — ${ref.relevance}`);
      }
    }

    // Also include some general taxonomy context
    for (const pov of POV_KEYS) {
      const ctx = getTaxonomyContext(pov);
      for (const n of ctx.povNodes.slice(0, 5)) {
        if (!allNodes.some((l) => l.includes(n.id))) {
          allNodes.push(`[${n.id}] ${n.label}: ${n.description}`);
        }
      }
    }

    // Gather conflict data — filter by relevance to the statement's taxonomy refs
    const conflicts = useTaxonomyStore.getState().conflicts || [];
    const refNodeIds = new Set((sourceEntry?.taxonomy_refs || []).map(r => r.node_id));
    const conflictLines: string[] = [];
    for (const c of conflicts as { claim_id?: string; claim_label?: string; description?: string; status?: string; linked_taxonomy_nodes?: string[] }[]) {
      if (!c.claim_label) continue;
      // Prioritize conflicts that share taxonomy nodes with the statement
      const linked = Array.isArray(c.linked_taxonomy_nodes) ? c.linked_taxonomy_nodes : [];
      const isRelevant = linked.some(n => refNodeIds.has(n));
      if (isRelevant) {
        conflictLines.unshift(`[${c.claim_id || 'unknown'}] ${c.claim_label}: ${c.description || ''} (${c.status || 'open'})`);
      } else if (conflictLines.length < 10) {
        // Text similarity fallback — check if conflict label overlaps with claim
        const claimWords = new Set(selectedText.toLowerCase().split(/\s+/).filter(w => w.length > 4));
        const labelWords = (c.claim_label || '').toLowerCase().split(/\s+/);
        const overlap = labelWords.filter(w => claimWords.has(w)).length;
        if (overlap >= 2) {
          conflictLines.push(`[${c.claim_id || 'unknown'}] ${c.claim_label} (${c.status || 'open'})`);
        }
      }
    }

    // Step 1: Run grounded web search for external verification
    // Gemini uses native google_search grounding; non-Gemini backends use
    // Tavily search + LLM when TAVILY_API_KEY is configured (see embeddings.ts).
    set({ debateActivity: `Searching the web for evidence (${model})` });
    let webContext = '';
    let searchQueries: string[] = [];
    let webCitations: import('../../bridge/types').GroundingCitation[] = [];
    try {
      const searchResult = await api.generateTextWithSearch(
        `Fact-check this claim from an AI policy debate. Find recent, authoritative sources that support or contradict it. Be specific about what evidence you found.\n\nClaim: "${selectedText}"\n\nContext: ${statementContext.slice(0, 500)}`,
        model,
      );
      webContext = searchResult.text;
      searchQueries = searchResult.searchQueries || [];
      webCitations = searchResult.citations || [];
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'warn',
        message: 'Fact-check web search failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      console.warn('[factCheck] Web search failed, proceeding with internal data only:', err);
      pushWarning(get, set, 'Web search unavailable for fact-check');
      webContext = '(Web search unavailable)';
    }
    if (!isStillValid()) return;

    // Step 2: Run main fact-check with all evidence
    const prompt = buildFactCheckPrompt(
      selectedText,
      statementContext,
      allNodes.join('\n'),
      conflictLines.slice(0, 15).join('\n') + (webContext ? `\n\n=== WEB SEARCH RESULTS ===\n${webContext}` : ''),
      activeDebate.audience,
    );

    try {
      set({ debateActivity: `Analyzing evidence (${model})` });
      const { text } = await generateTextWithProgress(prompt, model, `Fact-checking claim (${model})`, set);
      if (!isStillValid()) return;

      let result = parseAIJson<{ verdict?: string; explanation?: string; sources?: unknown[]; points?: unknown[] }>(text);
      if (!result) {
        result = { verdict: 'unverifiable', explanation: text.trim(), sources: [], points: [] };
      }

      const verdictLabels: Record<string, string> = {
        supported: 'Supported',
        disputed: 'Disputed',
        unverifiable: 'Unverifiable',
        false: 'False',
      };

      const sources = Array.isArray(result.sources) ? result.sources : [];
      const sourceRefs = sources
        .filter((s: Record<string, unknown>) => s.node_id || s.conflict_id)
        .map((s: Record<string, unknown>) => ({
          node_id: (s.node_id as string) || (s.conflict_id as string) || '',
          relevance: s.conflict_id ? `Conflict: ${s.conflict_id}` : '',
        }));

      const webNote = searchQueries.length > 0
        ? `\n\n*Web sources consulted: ${searchQueries.slice(0, 3).join(', ')}*`
        : webContext && webContext !== '(Web search unavailable)'
          ? '\n\n*Verified against web search results*'
          : '';

      addTranscriptEntry({
        type: 'fact-check',
        speaker: 'system',
        content: `**Fact Check: ${verdictLabels[result.verdict] || result.verdict}**\n\n"${selectedText}"\n\n${result.explanation}${webNote}`,
        taxonomy_refs: sourceRefs,
        metadata: {
          fact_check: {
            verdict: result.verdict,
            explanation: result.explanation,
            sources: result.sources,
            checked_text: selectedText,
            web_search_used: !!webContext && webContext !== '(Web search unavailable)',
            web_search_queries: searchQueries,
            web_search_evidence: webContext && webContext !== '(Web search unavailable)' ? webContext : undefined,
            web_search_citations: webCitations.length ? webCitations : undefined,
          },
        },
      });

      // ── Generate AN nodes and edges from fact-check points ──
      // Always create AN nodes for a fact-check so the argument network captures
      // the evidence. Falls back gracefully when:
      //   - LLM omitted `points` → synthesize one from verdict+explanation
      //   - No existing AN nodes match entryId → synthesize a target node from selectedText
      const rawPoints = Array.isArray(result.points) ? result.points as { text: string; type?: 'supports' | 'attacks'; evidence_basis?: string }[] : [];
      const points = rawPoints.filter(p => p && p.text && p.text.length > 0);
      const debate = get().activeDebate;
      if (debate) {
        const an = debate.argument_network || { nodes: [], edges: [] };
        const factCheckEntryId = debate.transcript[debate.transcript.length - 1]?.id || generateId();
        const baseTurnNumber = an.nodes.length > 0 ? Math.max(...an.nodes.map(n => n.turn_number)) + 1 : 1;

        // Find AN nodes belonging to the checked statement
        const targetNodes = an.nodes.filter(n => n.source_entry_id === entryId);
        const checkedWords = new Set(selectedText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const rankedTargets = targetNodes
          .map(n => {
            const words = n.text.toLowerCase().split(/\s+/);
            const overlap = words.filter(w => checkedWords.has(w)).length;
            return { node: n, overlap };
          })
          .sort((a, b) => b.overlap - a.overlap);

        let nextNodeIdx = an.nodes.length;
        let nextEdgeIdx = an.edges.length;
        const newNodes: typeof an.nodes = [];
        const newEdges: typeof an.edges = [];

        // If no existing target AN node for this entry, synthesize one from the
        // selected text so fact-check findings have something to attach to.
        let bestTarget = rankedTargets[0]?.node;
        if (!bestTarget) {
          const syntheticId = `AN-${nextNodeIdx++}`;
          const syntheticNode = {
            id: syntheticId,
            text: selectedText.length > 300 ? selectedText.slice(0, 297) + '...' : selectedText,
            speaker: 'system' as const,
            source_entry_id: entryId,
            taxonomy_refs: [],
            turn_number: baseTurnNumber,
            base_strength: 0.5,
            scoring_method: 'unscored' as const,
            bdi_category: 'belief' as const,
            specificity: 'precise' as const,
          };
          newNodes.push(syntheticNode);
          bestTarget = syntheticNode;
        }

        // If the LLM returned no usable points, synthesize one from the verdict + explanation
        // so the fact-check still appears in the argument network.
        const pointsToAdd = points.length > 0 ? points : [{
          text: result.explanation || `Fact-check verdict: ${result.verdict}`,
          type: (result.verdict === 'disputed' || result.verdict === 'false') ? 'attacks' as const : 'supports' as const,
          evidence_basis: 'mixed',
        }];

        for (const pt of pointsToAdd.slice(0, 4)) {
          if (!pt.text) continue;
          const attackType = pt.type === 'attacks' ? 'attacks' : 'supports';
          const nodeId = `AN-${nextNodeIdx++}`;
          newNodes.push({
            id: nodeId,
            text: pt.text,
            speaker: 'system',
            source_entry_id: factCheckEntryId,
            taxonomy_refs: [],
            turn_number: baseTurnNumber,
            base_strength: attackType === 'attacks' ? 0.7 : 0.6,
            scoring_method: 'bdi_criteria',
            bdi_category: 'belief',
            specificity: 'precise',
          });
          const edgeId = `AE-${nextEdgeIdx++}`;
          newEdges.push({
            id: edgeId,
            source: nodeId,
            target: bestTarget.id,
            type: attackType,
            attack_type: attackType === 'attacks' ? 'rebut' : undefined,
            scheme: attackType === 'attacks' ? 'EMPIRICAL CHALLENGE' : 'EXTEND',
            warrant: `Fact-check evidence (${pt.evidence_basis || 'mixed'}): ${pt.text.slice(0, 100)}`,
            argumentation_scheme: 'ARGUMENT_FROM_EVIDENCE',
          });
        }

        if (newNodes.length > 0) {
          commitAnNodes(get, set, `factcheck(manual,entry=${entryId.slice(-6)})`, newNodes, newEdges);
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: 'error',
        message: 'Fact check failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      if (isDailyLimitError(err)) {
        set({ debateError: DAILY_LIMIT_MESSAGE, dailyLimitPaused: true });
      } else {
        set({ debateError: `Fact check failed: ${mapErrorToUserMessage(err)}`, debateRetryAction: 'factCheck' });
      }
    } finally {
      set({ debateGenerating: null });
      await saveDebate('factCheckSelection');
    }
  },

  // ── Phase 8: Context Window Management ───────────────────

  compressOldTranscript: async () => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;

    const transcript = activeDebate.transcript;
    // Only compress if there are enough entries (keep last 8, compress the rest)
    const KEEP_RECENT = 8;
    const MIN_TO_COMPRESS = 12;

    if (transcript.length < MIN_TO_COMPRESS) return;

    // Find entries that haven't been summarized yet
    const lastSummaryIdx = activeDebate.context_summaries.length > 0
      ? transcript.findIndex((e) => e.id === activeDebate.context_summaries[activeDebate.context_summaries.length - 1].up_to_entry_id)
      : -1;

    const startIdx = lastSummaryIdx + 1;
    const endIdx = transcript.length - KEEP_RECENT;

    if (endIdx <= startIdx) return; // Nothing to compress

    const toCompress = transcript.slice(startIdx, endIdx);
    if (toCompress.length < 4) return; // Not enough to bother

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateWarnings: [], debateGenerating: 'system' as SpeakerId });

    const model = getConfiguredModel();
    const entriesText = toCompress.map((e) => {
      const label = e.speaker === 'user' ? 'Moderator'
        : e.speaker === 'system' ? 'System'
        : POVER_INFO[e.speaker as Exclude<SpeakerId, 'user'>]?.label || e.speaker;
      return `${label} [${e.type}]: ${e.content}`;
    }).join('\n\n');

    const prompt = buildContextCompressionPrompt(entriesText, activeDebate.audience);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Compressing debate history (${model})`, set);
      if (!isStillValid()) return;

      let summary: string;
      const compParsed = parseAIJson<{ summary?: string }>(text);
      summary = compParsed?.summary || text.trim();

      const lastCompressedEntry = toCompress[toCompress.length - 1];
      const updatedSummaries = [
        ...activeDebate.context_summaries,
        { up_to_entry_id: lastCompressedEntry.id, summary },
      ];

      set({
        activeDebate: {
          ...get().activeDebate!,
          context_summaries: updatedSummaries,
          updated_at: nowISO(),
        },
      });

      await saveDebate('compressOldTranscript');
    } catch (err) {
      const errCode = (err as Record<string, unknown> | null)?.errorCode;
      const isContextOverflow = errCode === 'context_too_long'
        || String(err).includes('context_too_long')
        || String(err).includes('context window');

      getGlobalRecorder()?.record({
        type: 'system.error',
        debate_id: activeDebate?.id,
        component: 'debate-store',
        level: isContextOverflow ? 'warn' : 'error',
        message: isContextOverflow ? 'Context compression hit token limit — using non-LLM fallback' : 'Context compression failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });

      if (isContextOverflow && isStillValid()) {
        const lastCompressedEntry = toCompress[toCompress.length - 1];
        const fallbackSummary = toCompress.map((e) => {
          const label = e.speaker === 'user' ? 'Moderator'
            : e.speaker === 'system' ? 'System'
            : POVER_INFO[e.speaker as Exclude<SpeakerId, 'user'>]?.label || e.speaker;
          const snippet = e.content.length > 120 ? e.content.slice(0, 120) + '...' : e.content;
          return `- ${label} (${e.type}): ${snippet}`;
        }).join('\n');

        set({
          activeDebate: {
            ...get().activeDebate!,
            context_summaries: [
              ...activeDebate.context_summaries,
              { up_to_entry_id: lastCompressedEntry.id, summary: fallbackSummary },
            ],
            updated_at: nowISO(),
          },
        });
        await saveDebate('compressOldTranscript');
        pushWarning(get, set, 'Context was too long for AI compression — used a shortened summary instead.');
      } else {
        pushWarning(get, set, `Context compression skipped: ${mapErrorToUserMessage(err)}`);
      }
    } finally {
      set({ debateGenerating: null });
    }
  },

});
