// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from '../internals.js';
import { POV_KEYS } from '../../types.js';
import { probingQuestionsPrompt } from '../../prompts.js';
import { parseJsonRobust, formatRecentTranscript } from '../../helpers.js';
import { computeCoverageMap, computeStrengthWeightedCoverage } from '../../coverageTracker.js';
import { getGlobalRecorder } from '../../../flight-recorder/index.js';

// ── Probing questions ──────────────────────────────────────

export async function runProbingQuestions(engine: DebateEngineInternals, round: number): Promise<void> {
  engine.progress('probing', undefined, 'Generating probing questions');

  // Find unreferenced nodes
  const referencedIds = new Set<string>();
  for (const e of engine.session.transcript) {
    for (const ref of e.taxonomy_refs) referencedIds.add(ref.node_id);
  }

  const unreferencedNodes: string[] = [];
  for (const pov of POV_KEYS) {
    const nodes = engine.taxonomy[pov]?.nodes ?? [];
    for (const n of nodes) {
      if (!referencedIds.has(n.id) && unreferencedNodes.length < 20) {
        unreferencedNodes.push(`[${n.id}] ${n.label}: ${n.description.slice(0, 100)}`);
      }
    }
  }

  const transcript = formatRecentTranscript(engine.session.transcript, 50, engine.session.context_summaries);
  const hasSourceDoc = engine.config.sourceType === 'document' || engine.config.sourceType === 'url';

  // CT-4/CT-11: Compute uncovered document claims, sorted by QBAF strength weight (load-bearing first)
  let uncoveredClaims: string[] | undefined;
  if (engine.session.document_analysis?.i_nodes?.length) {
    const anNodes = engine.session.argument_network?.nodes ?? [];
    const anEdges = engine.session.argument_network?.edges ?? [];
    if (anNodes.length > 0) {
      try {
        const documentClaims = engine.session.document_analysis.i_nodes.map(n => ({ id: n.id, text: n.text, bdi_category: n.type }));
        const coverageMap = computeCoverageMap(anNodes, documentClaims);
        const sw = computeStrengthWeightedCoverage(coverageMap, anNodes, anEdges);
        const weightByClaimId = new Map(sw.claim_weights.map(w => [w.claimId, w.weight]));
        uncoveredClaims = coverageMap.coverage
          .filter(c => c.status === 'uncovered')
          .sort((a, b) => (weightByClaimId.get(b.claimId) ?? 0.5) - (weightByClaimId.get(a.claimId) ?? 0.5))
          .map(c => {
            const text = documentClaims.find(dc => dc.id === c.claimId)?.text ?? c.claimId;
            return `[${c.claimId}] ${text}`;
          })
          .slice(0, 10);
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Probing coverage computation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      }
    }
  }

  const prompt = probingQuestionsPrompt(engine.session.topic.final, transcript, unreferencedNodes, hasSourceDoc, uncoveredClaims, engine.config.audience);
  const text = await engine.generate(prompt, 'Probing questions');

  let questions: { text: string; targets: string[] }[] = [];
  try {
    const parsed = parseJsonRobust(text) as { questions?: { text?: string; question?: string; targets?: string[]; options?: string[] }[] };
    questions = (parsed.questions ?? []).map(q => ({ text: q.text ?? q.question ?? '', targets: q.targets ?? q.options ?? [] }));
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Parsing probing questions failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    engine.warn('Parsing probing questions', err, 'Skipping probing questions for this round');
  }

  if (questions.length > 0) {
    const content = questions.map((q, i) => {
      const qText = q.text || JSON.stringify(q);
      const targets = q.targets;
      const targetStr = Array.isArray(targets) ? targets.join(', ') : 'all';
      return `${i + 1}. ${qText} (targets: ${targetStr})`;
    }).join('\n');
    engine.addEntry({
      type: 'probing',
      speaker: 'system',
      content,
      taxonomy_refs: [],
      metadata: { questions, round },
    });
  }
}
