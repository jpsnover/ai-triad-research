// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Catalog of all AI prompts used in the system.
 * Each entry provides a title, description, source location, and either
 * a static template or a generate function for node-specific prompts.
 */

import { researchPrompt, conflictResearchPrompt } from '../prompts/research';
import {
  distinctionAnalysisPrompt,
  clusterLabelPrompt,
} from '../prompts/analysis';
import {
  clarificationPrompt,
  synthesisPrompt,
  openingStatementPrompt,
  debateResponsePrompt,
  crossRespondSelectionPrompt,
  crossRespondPrompt,
  debateSynthesisPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
  crossCuttingClarificationPrompt,
} from '../prompts/debate';

export interface PromptCatalogEntry {
  id: string;
  title: string;
  description: string;
  source: string;
  template: string;
  /** If provided, generates a node-specific prompt from label + description */
  generate?: (label: string, description: string) => string;
}

export const PROMPT_CATALOG: PromptCatalogEntry[] = [
  // === Research (reserved top item) ===
  {
    id: 'research',
    title: 'Research',
    description: 'Generates a research prompt for the selected taxonomy node. Investigates supporting evidence, critiques, and consensus shifts.',
    source: 'prompts/research.ts',
    template: '(Select a taxonomy node to generate this prompt)',
    generate: (label, description) => researchPrompt(label, description),
  },

  // === TypeScript prompts (taxonomy-editor) ===
  {
    id: 'conflict-research',
    title: 'Conflict Research',
    description: 'Investigates a factual conflict between sources — audits evidence, identifies root causes of disagreement, and assesses resolvability.',
    source: 'prompts/research.ts',
    template: conflictResearchPrompt('{claim_label}', '{description}', '{stances}'),
  },
  {
    id: 'distinction-analysis',
    title: 'Distinction Analysis',
    description: 'Compares two taxonomy elements to determine if they are identical, redundant, or meaningfully distinct.',
    source: 'prompts/analysis.ts',
    template: distinctionAnalysisPrompt(
      { category: '{category_A}', label: '{label_A}', description: '{description_A}' },
      { category: '{category_B}', label: '{label_B}', description: '{description_B}' },
    ),
  },
  {
    id: 'cluster-label',
    title: 'Cluster Labeling',
    description: 'Generates short thematic labels for clusters of semantically similar taxonomy nodes.',
    source: 'prompts/analysis.ts',
    template: clusterLabelPrompt([{ nodeIds: ['{node_id}'], labels: ['{label_1}', '{label_2}'] }]),
  },
  {
    id: 'debate-clarification',
    title: 'Debate: Clarification',
    description: 'Generates 1-3 neutral clarifying questions before a debate begins to narrow scope and surface assumptions.',
    source: 'prompts/debate.ts',
    template: clarificationPrompt('{topic}'),
  },
  {
    id: 'debate-cc-clarification',
    title: 'Debate: CC Clarification',
    description: 'Generates 1-3 clarifying questions for a debate grounded in a cross-cutting concern, using the full CC node context.',
    source: 'prompts/debate.ts',
    template: crossCuttingClarificationPrompt('{topic}', '{cc_context}'),
  },
  {
    id: 'debate-synthesis-topic',
    title: 'Debate: Topic Synthesis',
    description: 'Synthesizes the original debate topic with clarifying Q&A into a refined topic statement.',
    source: 'prompts/debate.ts',
    template: synthesisPrompt('{original_topic}', '{qa_pairs}'),
  },
  {
    id: 'debate-opening',
    title: 'Debate: Opening Statement',
    description: 'Generates an opening statement for a debater, grounded in taxonomy positions.',
    source: 'prompts/debate.ts',
    template: openingStatementPrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '', true),
  },
  {
    id: 'debate-response',
    title: 'Debate: Response',
    description: 'Generates a debate response to a question or challenge, engaging with prior history.',
    source: 'prompts/debate.ts',
    template: debateResponsePrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '{transcript}', '{question}', '{addressing}'),
  },
  {
    id: 'debate-cross-selection',
    title: 'Debate: Cross-Respond Selection',
    description: 'Moderator analysis to pick which debater should respond next and about what point.',
    source: 'prompts/debate.ts',
    template: crossRespondSelectionPrompt('{recent_transcript}', ['{debater_1}', '{debater_2}']),
  },
  {
    id: 'debate-cross-respond',
    title: 'Debate: Cross-Respond',
    description: 'Generates a cross-response between debaters on a specific focus point.',
    source: 'prompts/debate.ts',
    template: crossRespondPrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '{transcript}', '{focus_point}', '{addressing}'),
  },
  {
    id: 'debate-full-synthesis',
    title: 'Debate: Full Synthesis',
    description: 'Analyzes a complete debate transcript — identifies agreements, disagreements, unresolved questions, and taxonomy coverage.',
    source: 'prompts/debate.ts',
    template: debateSynthesisPrompt('{topic}', '{transcript}'),
  },
  {
    id: 'debate-probing',
    title: 'Debate: Probing Questions',
    description: 'Generates 3-5 probing questions to advance a debate, targeting unstated assumptions or unexplored areas.',
    source: 'prompts/debate.ts',
    template: probingQuestionsPrompt('{topic}', '{transcript}', ['{unreferenced_node}']),
  },
  {
    id: 'debate-fact-check',
    title: 'Debate: Fact Check',
    description: 'Evaluates a claim from a debate for factual accuracy against taxonomy data and known conflicts.',
    source: 'prompts/debate.ts',
    template: factCheckPrompt('{selected_text}', '{statement_context}', '{taxonomy_nodes}', '{conflict_data}'),
  },
  {
    id: 'debate-compression',
    title: 'Debate: Context Compression',
    description: 'Summarizes a debate segment concisely for use as compressed context in subsequent turns.',
    source: 'prompts/debate.ts',
    template: contextCompressionPrompt('{debate_entries}'),
  },

  // === PowerShell prompts (backend AITriad module) ===
  {
    id: 'ps-pov-summary',
    title: 'POV Summary',
    description: 'Reads a source document and produces structured analysis mapping its claims to the four-POV taxonomy.',
    source: 'AITriad/Prompts/pov-summary-system.prompt',
    template: '(PowerShell backend prompt — used by Invoke-POVSummary)',
  },
  {
    id: 'ps-pov-summary-chunk',
    title: 'POV Summary (Chunked)',
    description: 'Analyzes one section of a larger document that has been split for processing.',
    source: 'AITriad/Prompts/pov-summary-chunk-system.prompt',
    template: '(PowerShell backend prompt — used for large document summarization)',
  },
  {
    id: 'ps-attribute-extraction',
    title: 'Attribute Extraction',
    description: 'Generates rich analytical attributes (epistemic type, rhetorical strategy, intellectual lineage, etc.) for taxonomy nodes.',
    source: 'AITriad/Prompts/attribute-extraction.prompt',
    template: '(PowerShell backend prompt — used by Invoke-AttributeExtraction)',
  },
  {
    id: 'ps-edge-discovery',
    title: 'Edge Discovery',
    description: 'Discovers typed, directed edges between taxonomy nodes to build the knowledge graph.',
    source: 'AITriad/Prompts/edge-discovery.prompt',
    template: '(PowerShell backend prompt — used by Invoke-EdgeDiscovery)',
  },
  {
    id: 'ps-fallacy-analysis',
    title: 'Fallacy Analysis',
    description: 'Examines taxonomy nodes to identify potential logical fallacies in their reasoning.',
    source: 'AITriad/Prompts/fallacy-analysis.prompt',
    template: '(PowerShell backend prompt — used by Invoke-FallacyAnalysis)',
  },
  {
    id: 'ps-graph-query',
    title: 'Graph Query',
    description: 'Natural language questions translated into graph-traversal reasoning via LLM.',
    source: 'AITriad/Prompts/graph-query.prompt',
    template: '(PowerShell backend prompt — used by Invoke-GraphQuery)',
  },
  {
    id: 'ps-metadata-extraction',
    title: 'Metadata Extraction',
    description: 'Extracts structured metadata (title, authors, date, topics) from ingested documents.',
    source: 'AITriad/Prompts/metadata-extraction.prompt',
    template: '(PowerShell backend prompt — used by Import-AITriadDocument)',
  },
  {
    id: 'ps-taxonomy-proposal',
    title: 'Taxonomy Proposal',
    description: 'Proposes new taxonomy nodes based on analysis of source material and existing taxonomy gaps.',
    source: 'AITriad/Prompts/taxonomy-proposal.prompt',
    template: '(PowerShell backend prompt — used by Invoke-TaxonomyProposal)',
  },
  {
    id: 'ps-cross-cutting-candidates',
    title: 'Cross-Cutting Candidates',
    description: 'Evaluates clusters of similar nodes from different POVs as candidates for new cross-cutting nodes.',
    source: 'AITriad/Prompts/cross-cutting-candidates.prompt',
    template: '(PowerShell backend prompt — used by Find-CrossCuttingCandidates)',
  },
  {
    id: 'ps-ingestion-priority',
    title: 'Ingestion Priority',
    description: 'Scores and ranks research gaps — orphans, one-sided conflicts, echo chambers, coverage imbalance.',
    source: 'AITriad/Prompts/ingestion-priority.prompt',
    template: '(PowerShell backend prompt — used by Get-IngestionPriority)',
  },
  {
    id: 'ps-topic-frequency-label',
    title: 'Topic Frequency Labeling',
    description: 'Labels thematic clusters identified by topic frequency analysis across the taxonomy.',
    source: 'AITriad/Prompts/topic-frequency-label.prompt',
    template: '(PowerShell backend prompt — used for topic analysis)',
  },
  {
    id: 'ps-triad-dialogue-system',
    title: 'Triad Dialogue: System',
    description: 'System prompt for the three debate agents (Prometheus, Sentinel, Cassandra) in structured triad dialogues.',
    source: 'AITriad/Prompts/triad-dialogue-system.prompt',
    template: '(PowerShell backend prompt — used by Show-TriadDialogue)',
  },
  {
    id: 'ps-triad-dialogue-turn',
    title: 'Triad Dialogue: Turn',
    description: 'Generates a single debate turn for a triad dialogue agent, incorporating prior context.',
    source: 'AITriad/Prompts/triad-dialogue-turn.prompt',
    template: '(PowerShell backend prompt — used by Show-TriadDialogue)',
  },
  {
    id: 'ps-triad-dialogue-synthesis',
    title: 'Triad Dialogue: Synthesis',
    description: 'Synthesizes a completed triad dialogue into areas of agreement, disagreement, and open questions.',
    source: 'AITriad/Prompts/triad-dialogue-synthesis.prompt',
    template: '(PowerShell backend prompt — used by Show-TriadDialogue)',
  },
];
