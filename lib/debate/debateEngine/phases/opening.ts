// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from '../internals.js';
import path from 'path';
import { POVER_INFO } from '../../types.js';
import { formatVocabularyContext } from '../../vocabularyContext.js';
import { getGlobalRecorder } from '../../../flight-recorder/index.js';
import { runOpeningPipeline, assembleOpeningPipelineResult, getOpeningRepairHints, type OpeningPipelineInput } from '../../turnPipeline.js';
import { resolveModelForSpeaker } from '../modelResolution.js';
import { accumulateContextManifest } from '../adaptiveStaging.js';
import { enrichTaxonomyRefs, getRelevantTaxonomyContext, formatDebaterEdgeContext } from '../taxonomyContext.js';
import { getCommitmentContext, getEstablishedPointsContext } from '../context.js';

// ── Phase: Opening statements ──────────────────────────────

export async function runOpeningStatements(engine: DebateEngineInternals): Promise<void> {
  engine.session.phase = 'opening';

  // Shuffle opening order (Fisher-Yates)
  const order = [...engine.config.activePovers];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const priorStatements: { speaker: string; pov: string; poverId: string; statement: string; summary: string }[] = [];

  for (const poverId of order) {
    // Per-iteration idempotency: skip speakers who already have an opening (t/919)
    if (engine.session.transcript.some(e => e.type === 'opening' && e.speaker === poverId)) {
      continue;
    }

    const info = POVER_INFO[poverId];
    engine.progress('opening', poverId, `${info.label} preparing opening statement`);

    const taxonomyContext = await getRelevantTaxonomyContext(engine, info.pov);
    const commitmentContext = getCommitmentContext(engine, poverId);
    const establishedPoints = getEstablishedPointsContext(engine, poverId);
    const { text: edgeContext, edges_used: openingEdgesUsed } = formatDebaterEdgeContext(engine, info.pov);

    let priorBlock = '';
    if (priorStatements.length > 0) {
      priorBlock = '\n\n=== PRIOR OPENING POSITIONS (structured) ===\n';
      const an = engine.session.argument_network;
      for (const ps of priorStatements) {
        priorBlock += `\n--- ${ps.speaker} (${ps.pov}) ---\n`;
        priorBlock += `Summary: ${ps.summary}\n\n`;

        // Get AN nodes from this speaker's opening
        const speakerNodes = (an?.nodes ?? []).filter(n =>
          n.speaker === ps.poverId &&
          (n as any).source_round === 0
        );

        if (speakerNodes.length > 0) {
          priorBlock += 'Claims extracted:\n';
          for (const node of speakerNodes) {
            const bdi = node.bdi_category ?? 'unknown';
            const strength = node.scoring_method === 'bdi_composite' ? 'composite'
              : node.scoring_method === 'unscored' ? 'unscored' : 'bdi_criteria';
            const refs = (node as any).taxonomy_refs?.slice(0, 2).join(', ') ?? '';
            const refsLabel = refs ? ` → grounded in ${refs}` : '';
            priorBlock += `- [${node.id}] (${bdi}, ${strength}) "${node.text.slice(0, 120)}"${refsLabel}\n`;
          }
        } else {
          priorBlock += `(No structured claims extracted yet)\n`;
        }
        priorBlock += '\n';
      }
    }

    const vocabContext = engine.config.vocabulary
      ? '\n' + formatVocabularyContext({ pov: info.pov, ...engine.config.vocabulary })
      : '';
    const fullContext = taxonomyContext + vocabContext + commitmentContext + establishedPoints + edgeContext;

    // ── 4-stage pipeline: BRIEF → PLAN → DRAFT → CITE ──
    const userSeeds = (engine.session.argument_network?.nodes || [])
      .filter(n => n.speaker === 'user' && n.id.startsWith('user-seed-'))
      .map(n => ({ id: n.id, text: n.text, bdi_category: n.bdi_category }));

    const pipelineInput: OpeningPipelineInput = {
      label: info.label,
      pov: info.pov,
      personality: info.personality,
      topic: engine.session.topic.final,
      background: engine.session.topic.background || undefined,
      taxonomyContext: fullContext,
      priorStatements: priorBlock,
      isFirst: priorStatements.length === 0,
      sourceContent: engine.session.document_analysis ? undefined : engine.config.sourceContent,
      documentAnalysis: engine.session.document_analysis,
      audience: engine.config.audience,
      model: resolveModelForSpeaker(engine, poverId),
      briefModel: engine.config.stageModels?.brief,
      planModel: engine.config.stageModels?.plan,
      draftModel: engine.config.stageModels?.draft,
      citeModel: engine.config.stageModels?.cite,
      userSeedClaims: userSeeds.length > 0 ? userSeeds : undefined,
      availablePovNodeIds: [...engine.getKnownNodeIds()],
      ...(engine.config.temperature != null ? {
        stageTemperatures: {
          brief_temperature: engine.config.temperature,
          plan_temperature: engine.config.temperature,
          draft_temperature: engine.config.temperature,
          cite_temperature: engine.config.temperature,
        },
      } : {}),
    };

    getGlobalRecorder()?.setEventContext({
      debate_id: engine.session.id,
      run_id: engine.session.run_id,
      speaker: poverId,
      phase: 'opening',
      round: 0,
      turn_index: engine.session.transcript.length,
    });
    let pipelineResult = await engine.executeWithModelFailover(poverId, async (model) => {
      const input = { ...pipelineInput, model };
      let result = await runOpeningPipeline(
        input,
        engine.stageGenerate.bind(engine),
        (_stage, label) => engine.progress('opening', poverId, label),
      );

      const repairHints = getOpeningRepairHints(result);
      if (repairHints.length > 0) {
        engine.progress('opening', poverId, `${info.label} retrying (${repairHints.length} issue${repairHints.length > 1 ? 's' : ''})`);
        try {
          result = await runOpeningPipeline(
            { ...input, repairHints },
            engine.stageGenerate.bind(engine),
            (_stage, label) => engine.progress('opening', poverId, label),
          );
        } catch (err) {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Opening retry failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
          engine.warn('Opening retry', err, 'Using first attempt');
        }
      }
      return result;
    });

    const { statement, taxonomyRefs, meta } = assembleOpeningPipelineResult(pipelineResult, engine.getKnownNodeIds());
    enrichTaxonomyRefs(engine, taxonomyRefs);

    const speakerModel = resolveModelForSpeaker(engine, poverId);
    const entry = engine.addEntry({
      type: 'opening',
      speaker: poverId,
      content: statement,
      taxonomy_refs: taxonomyRefs,
      policy_refs: meta.policy_refs,
      model: engine.config.speakerModels ? speakerModel : undefined,
      metadata: {
        key_assumptions: meta.key_assumptions,
        my_claims: meta.my_claims,
        turn_symbols: meta.turn_symbols,
        injection_manifest: engine._lastInjectionManifest ?? undefined,
      },
    });

    // Accumulate context manifest for taxonomy gap analysis
    accumulateContextManifest(engine, 0, poverId, info.pov, taxonomyRefs.map(r => r.node_id));

    const draftDiag = pipelineResult.stage_diagnostics.find(s => s.stage === 'draft');
    engine.recordDiagnostic(entry.id, {
      prompt: draftDiag?.prompt ?? '',
      raw_response: draftDiag?.raw_response ?? '',
      model: speakerModel,
      response_time_ms: pipelineResult.total_time_ms,
      taxonomy_context: taxonomyContext,
      commitment_context: commitmentContext,
      stage_diagnostics: pipelineResult.stage_diagnostics,
      edges_used: openingEdgesUsed,
    });

    // Embed framing_choices[].frame texts at opening finalization — t/2045
    try {
      const fc = pipelineResult.plan.framing_choices;
      if (Array.isArray(fc) && fc.length > 0) {
        const frames = fc
          .filter(f => typeof f?.frame === 'string' && (f.frame as string).trim().length > 0)
          .map(f => f.frame);
        if (frames.length > 0) {
          const { computeEmbeddings } = await import('../../../embeddings/onnxEmbedding.js');
          const vecs = await computeEmbeddings(frames);
          engine.session.frame_embeddings ??= {};
          engine.session.frame_embeddings[poverId] = {
            model: 'all-MiniLM-L6-v2',
            dim: 384,
            frames: frames.map((frame, i) => ({ frame, embedding: vecs[i] })),
          };
        }
      }
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Frame embedding failed — frame survival metrics will be null', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
    }

    // Extract claims synchronously
    const anNodesBefore2 = engine.session.argument_network!.nodes.length;
    await engine._claimPipeline.extractClaims(statement, poverId, entry.id, taxonomyRefs.map(r => r.node_id), meta.my_claims);
    const newNodes2 = engine.session.argument_network!.nodes.slice(anNodesBefore2);

    // Post-extraction interventions (non-blocking)
    if (newNodes2.length > 0) {
      engine._claimPipeline.validateSteelmans(newNodes2, poverId).catch(err => engine.warn('Steelman validation', String(err), 'Opening steelman check skipped'));
      // t/1781: non-awaited (latency stays off the turn path) but tracked so the
      // completion path can settle it before the calibration extract. .catch()
      // makes the tracked promise resolve on failure (no unhandled rejection).
      engine._pendingClaimVerifications.push(engine._claimPipeline.verifyPreciseClaims(newNodes2).catch(err => { engine.warn('Precise claims', String(err), 'Opening precision check skipped'); }));
    }

    // Post-turn summarization (DT-2)
    await engine.summarizeEntry(entry);

    priorStatements.push({
      speaker: info.label,
      pov: info.pov,
      poverId,
      statement,
      summary: statement.split('\n')[0].slice(0, 150) + '...',
    });
  }

  engine.session.phase = 'debate';
}
