// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DebateEngineInternals } from '../internals.js';
import { type ExtendedAIAdapter } from '../../aiAdapter.js';
import { type ArgumentNetworkNode, POVER_INFO, type DocumentAnalysis } from '../../types.js';
import { documentAnalysisPrompt, buildTaxonomySample } from '../../documentAnalysis.js';
import { parseJsonRobust } from '../../helpers.js';
import { getGlobalRecorder } from '../../../flight-recorder/index.js';

// ── Phase: Document pre-analysis ───────────────────────────

export async function runDocumentAnalysis(engine: DebateEngineInternals): Promise<void> {
  engine.progress('analysis', undefined, 'Analyzing document claims');

  const taxonomySample = buildTaxonomySample(engine.taxonomy);
  const activePovers = engine.config.activePovers.map(
    p => POVER_INFO[p].pov,
  );
  const { prompt, truncationMetrics } = documentAnalysisPrompt(
    engine.config.sourceContent ?? '',
    engine.session.topic.final,
    activePovers,
    taxonomySample,
  );

  // Record document truncation context-rot metrics
  if (!engine.session.context_rot) {
    engine.session.context_rot = {
      schema_version: 1,
      pipeline: 'debate',
      doc_id: engine.session.id,
      measured_at: new Date().toISOString(),
      stages: [],
      cumulative_retention: 1,
    };
  }
  engine.session.context_rot.stages.push(truncationMetrics);

  const text = await engine.generate(prompt, 'Document analysis', 90_000);

  let analysis: DocumentAnalysis | null = null;
  try {
    analysis = parseJsonRobust(text) as DocumentAnalysis;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'debate-engine', level: 'warn', debate_id: engine.session?.id, message: 'Parsing document analysis failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    engine.warn('Parsing document analysis', err, 'Proceeding without document pre-analysis');
  }

  if (analysis && analysis.i_nodes && analysis.i_nodes.length > 0) {
    engine.session.document_analysis = analysis;

    // Add transcript entry recording the analysis
    const entry = engine.addEntry({
      type: 'system',
      speaker: 'system',
      content: `Document analysis complete: ${analysis.i_nodes.length} claims extracted, ${analysis.tension_points.length} tension points identified.\n\n${analysis.claims_summary}`,
      taxonomy_refs: [],
    });

    // Seed argument network with document i-nodes
    const an = engine.session.argument_network!;
    const adapter = engine.adapter as ExtendedAIAdapter;
    for (const inode of analysis.i_nodes) {
      const node: import('../../types.js').ArgumentNetworkNode = {
        id: inode.id,
        text: inode.text,
        attribution_text_genus: inode.attribution_text || undefined,
        speaker: 'document',
        source_entry_id: entry.id,
        taxonomy_refs: inode.taxonomy_refs,
        turn_number: 0,
        extraction_confidence: inode.extraction_confidence,
      };
      // Embed doc i-nodes for AN-based taxonomy relevance scoring
      if (adapter.computeQueryEmbedding) {
        try {
          const { vector } = await adapter.computeQueryEmbedding(inode.text.slice(0, 300));
          if (vector && vector.length > 0) node.embedding = vector;
        } catch { /* telemetry — silent by design: doc i-node embedding is best-effort */ }
        if (inode.attribution_text) {
          try {
            const { vector } = await adapter.computeQueryEmbedding(inode.attribution_text.slice(0, 300));
            if (vector && vector.length > 0) node.attribution_embedding = vector;
          } catch { /* best-effort: falls back to node.embedding for attribution */ }
        }
      }
      an.nodes.push(node);
    }

    engine.recordDiagnostic(entry.id, { prompt, raw_response: text });
  }
}
