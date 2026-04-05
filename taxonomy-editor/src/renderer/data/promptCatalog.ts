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
  situationClarificationPrompt,
} from '../prompts/debate';

export type PromptGroup = 'debate-setup' | 'debate-turns' | 'debate-analysis' | 'moderator' | 'chat' | 'taxonomy' | 'research' | 'powershell';
export type DataSourceId = 'taxonomyNodes' | 'situationNodes' | 'vulnerabilities' | 'fallacies' | 'policyRegistry' | 'sourceDocument' | 'commitments' | 'argumentNetwork' | 'establishedPoints';

export interface PromptCatalogEntry {
  id: string;
  title: string;
  description: string;
  source: string;
  template: string;
  /** If provided, generates a node-specific prompt from label + description */
  generate?: (label: string, description: string) => string;
  /** Prompt group for Inspector categorization */
  group: PromptGroup;
  /** 2-3 sentence explanation of when this prompt fires and what it produces */
  purpose: string;
  /** Debate phase this prompt belongs to (e.g., "opening", "response", "synthesis") */
  phase?: string;
  /** Which data sources are injected into this prompt */
  applicableDataSources: DataSourceId[];
  /** PS prompt file names (without .prompt extension) — loaded from disk via IPC */
  promptFiles?: string[];
  /** PS cmdlet parameters that configure this prompt at runtime */
  psParameters?: { name: string; type: string; default: string; description: string }[];
}

export const PROMPT_CATALOG: PromptCatalogEntry[] = [
  // === Research ===
  {
    id: 'research',
    title: 'Research',
    description: 'Generates a research prompt for the selected taxonomy node. Investigates supporting evidence, critiques, and consensus shifts.',
    source: 'prompts/research.ts',
    template: '(Select a taxonomy node to generate this prompt)',
    generate: (label, description) => researchPrompt(label, description),
    group: 'research',
    purpose: 'Fires when the user clicks "Research" on a taxonomy node. Produces a structured research prompt that investigates supporting evidence, critiques, and scholarly consensus around the node\'s claims.',
    applicableDataSources: ['taxonomyNodes'],
  },
  {
    id: 'conflict-research',
    title: 'Conflict Research',
    description: 'Investigates a factual conflict between sources — audits evidence, identifies root causes of disagreement, and assesses resolvability.',
    source: 'prompts/research.ts',
    template: conflictResearchPrompt('{claim_label}', '{description}', '{stances}'),
    group: 'research',
    purpose: 'Fires when the user researches a conflict. Audits the evidence on each side, identifies why sources disagree, and evaluates whether the conflict is resolvable with available evidence.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
  },

  // === Taxonomy analysis ===
  {
    id: 'distinction-analysis',
    title: 'Distinction Analysis',
    description: 'Compares two taxonomy elements to determine if they are identical, redundant, or meaningfully distinct.',
    source: 'prompts/analysis.ts',
    template: distinctionAnalysisPrompt(
      { category: '{category_A}', label: '{label_A}', description: '{description_A}' },
      { category: '{category_B}', label: '{label_B}', description: '{description_B}' },
    ),
    group: 'taxonomy',
    purpose: 'Fires when the user compares two nodes via similarity search. Determines whether both nodes should exist or if one is redundant, and suggests merge or differentiation strategies.',
    applicableDataSources: ['taxonomyNodes'],
  },
  {
    id: 'cluster-label',
    title: 'Cluster Labeling',
    description: 'Generates short thematic labels for clusters of semantically similar taxonomy nodes.',
    source: 'prompts/analysis.ts',
    template: clusterLabelPrompt([{ nodeIds: ['{node_id}'], labels: ['{label_1}', '{label_2}'] }]),
    group: 'taxonomy',
    purpose: 'Fires during semantic clustering. Generates concise thematic labels for groups of nodes that cluster together by embedding similarity, helping users understand what ties them together.',
    applicableDataSources: ['taxonomyNodes'],
  },

  // === Debate setup ===
  {
    id: 'debate-clarification',
    title: 'Debate: Clarification',
    description: 'Generates 1-3 neutral clarifying questions before a debate begins to narrow scope and surface assumptions.',
    source: 'prompts/debate.ts',
    template: clarificationPrompt('{topic}'),
    group: 'debate-setup',
    purpose: 'Fires at the start of a new debate (topic-based). Generates neutral clarifying questions to narrow the debate scope and surface hidden assumptions before debaters engage.',
    phase: 'clarification',
    applicableDataSources: [],
  },
  {
    id: 'debate-situation-clarification',
    title: 'Debate: Situation Clarification',
    description: 'Generates 1-3 clarifying questions for a debate grounded in a situation node, using the full node context.',
    source: 'prompts/debate.ts',
    template: situationClarificationPrompt('{topic}', '{situation_context}'),
    group: 'debate-setup',
    purpose: 'Fires at the start of a situation-grounded debate. Uses the full situation node (all three POV interpretations) to generate targeted clarifying questions that probe the inter-POV disagreement.',
    phase: 'clarification',
    applicableDataSources: ['situationNodes'],
  },
  {
    id: 'debate-synthesis-topic',
    title: 'Debate: Topic Synthesis',
    description: 'Synthesizes the original debate topic with clarifying Q&A into a refined topic statement.',
    source: 'prompts/debate.ts',
    template: synthesisPrompt('{original_topic}', '{qa_pairs}'),
    group: 'debate-setup',
    purpose: 'Fires after clarification Q&A. Combines the original topic with the user\'s answers to produce a refined, narrow topic statement that all debaters will argue about.',
    phase: 'synthesis',
    applicableDataSources: [],
  },

  // === Debate turns ===
  {
    id: 'debate-opening',
    title: 'Debate: Opening Statement',
    description: 'Generates an opening statement for a debater, grounded in taxonomy positions.',
    source: 'prompts/debate.ts',
    template: openingStatementPrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '', true),
    group: 'debate-turns',
    purpose: 'Fires at the start of each debate. Gives each debater their POV-grounded taxonomy context and asks them to state their position on the topic. The quality of this prompt determines how well-grounded the entire debate will be.',
    phase: 'opening',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'vulnerabilities', 'fallacies', 'policyRegistry', 'sourceDocument'],
  },
  {
    id: 'debate-response',
    title: 'Debate: Response',
    description: 'Generates a debate response to a question or challenge, engaging with prior history.',
    source: 'prompts/debate.ts',
    template: debateResponsePrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '{transcript}', '{question}', '{addressing}'),
    group: 'debate-turns',
    purpose: 'Fires for each debater turn after the opening. Includes taxonomy context, prior transcript, commitments, and argument network to produce a contextually aware response that engages with specific points from other debaters.',
    phase: 'response',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'vulnerabilities', 'fallacies', 'policyRegistry', 'sourceDocument', 'commitments', 'argumentNetwork', 'establishedPoints'],
  },
  {
    id: 'debate-cross-respond',
    title: 'Debate: Cross-Respond',
    description: 'Generates a cross-response between debaters on a specific focus point.',
    source: 'prompts/debate.ts',
    template: crossRespondPrompt('{debater}', '{pov}', '{personality}', '{topic}', '{taxonomy_context}', '{transcript}', '{focus_point}', '{addressing}'),
    group: 'debate-turns',
    purpose: 'Fires during cross-respond turns when the moderator directs a specific debater to address a specific point. Similar to response but with a narrower focus directive.',
    phase: 'cross-respond',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'vulnerabilities', 'commitments', 'argumentNetwork', 'establishedPoints'],
  },

  // === Moderator ===
  {
    id: 'debate-cross-selection',
    title: 'Debate: Cross-Respond Selection',
    description: 'Moderator analysis to pick which debater should respond next and about what point.',
    source: 'prompts/debate.ts',
    template: crossRespondSelectionPrompt('{recent_transcript}', ['{debater_1}', '{debater_2}']),
    group: 'moderator',
    purpose: 'Fires between debate turns to determine which debater should respond next and on what topic. Uses argument network and established points to find the most productive exchange to advance.',
    phase: 'cross-respond',
    applicableDataSources: ['argumentNetwork', 'establishedPoints'],
  },
  {
    id: 'debate-probing',
    title: 'Debate: Probing Questions',
    description: 'Generates 3-5 probing questions to advance a debate, targeting unstated assumptions or unexplored areas.',
    source: 'prompts/debate.ts',
    template: probingQuestionsPrompt('{topic}', '{transcript}', ['{unreferenced_node}']),
    group: 'moderator',
    purpose: 'Fires on demand during a debate. Identifies unstated assumptions, unexplored taxonomy nodes, and weak spots in the argument to generate questions that push the debate into more productive territory.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'argumentNetwork'],
  },

  // === Debate analysis ===
  {
    id: 'debate-full-synthesis',
    title: 'Debate: Full Synthesis',
    description: 'Analyzes a complete debate transcript — identifies agreements, disagreements, unresolved questions, and taxonomy coverage.',
    source: 'prompts/debate.ts',
    template: debateSynthesisPrompt('{topic}', '{transcript}'),
    group: 'debate-analysis',
    purpose: 'Fires at the end of a debate. Produces a comprehensive synthesis: areas of agreement, disagreement (with BDI layer and resolvability), cruxes, document claims, and preference verdicts. The highest-value prompt in the debate pipeline.',
    phase: 'synthesis',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'argumentNetwork', 'commitments'],
  },
  {
    id: 'debate-fact-check',
    title: 'Debate: Fact Check',
    description: 'Evaluates a claim from a debate for factual accuracy against taxonomy data and known conflicts.',
    source: 'prompts/debate.ts',
    template: factCheckPrompt('{selected_text}', '{statement_context}', '{taxonomy_nodes}', '{conflict_data}'),
    group: 'debate-analysis',
    purpose: 'Fires when a user selects text for fact-checking. Uses Gemini google_search for web evidence, cross-references against taxonomy claims and known conflicts. Produces a verdict with supporting evidence.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
  },
  {
    id: 'debate-compression',
    title: 'Debate: Context Compression',
    description: 'Summarizes a debate segment concisely for use as compressed context in subsequent turns.',
    source: 'prompts/debate.ts',
    template: contextCompressionPrompt('{debate_entries}'),
    group: 'debate-analysis',
    purpose: 'Fires automatically when transcript length exceeds context limits. Compresses earlier debate segments into concise summaries that preserve key arguments and commitments while reducing token usage.',
    applicableDataSources: [],
  },

  // === PowerShell prompts (backend AITriad module) ===
  {
    id: 'ps-pov-summary',
    title: 'POV Summary',
    description: 'Reads a source document and produces structured analysis mapping its claims to the four-POV taxonomy.',
    source: 'AITriad/Prompts/pov-summary-system.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-POVSummary. Reads a source document snapshot and produces structured key_points and factual_claims mapped to the taxonomy. The primary ingestion prompt.',
    applicableDataSources: ['sourceDocument', 'taxonomyNodes'],
    promptFiles: ['pov-summary-system', 'pov-summary-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for summarization' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
      { name: '-MaxTokens', type: 'number', default: '32768', description: 'Maximum response tokens' },
      { name: '-TimeoutSec', type: 'number', default: '120', description: 'API call timeout in seconds' },
    ],
  },
  {
    id: 'ps-pov-summary-chunk',
    title: 'POV Summary (Chunked)',
    description: 'Analyzes one section of a larger document that has been split for processing.',
    source: 'AITriad/Prompts/pov-summary-chunk-system.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used for large document summarization. Processes one chunk at a time, then results are merged. Same structure as POV Summary but scoped to a document section.',
    applicableDataSources: ['sourceDocument', 'taxonomyNodes'],
    promptFiles: ['pov-summary-chunk-system', 'pov-summary-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature' },
      { name: '-MaxTokens', type: 'number', default: '65536', description: 'Max response tokens (larger for chunks)' },
      { name: '-MaxChunkTokens', type: 'number', default: '15000', description: 'Max tokens per chunk' },
      { name: '-MinChunkTokens', type: 'number', default: '2000', description: 'Min tokens before merging into previous chunk' },
    ],
  },
  {
    id: 'ps-attribute-extraction',
    title: 'Attribute Extraction',
    description: 'Generates rich analytical attributes (epistemic type, rhetorical strategy, intellectual lineage, etc.) for taxonomy nodes.',
    source: 'AITriad/Prompts/attribute-extraction.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-AttributeExtraction. Populates graph_attributes on taxonomy nodes: epistemic_type, node_scope, rhetorical_strategy, audience, emotional_register, possible_fallacies, steelman_vulnerability, intellectual_lineage.',
    applicableDataSources: ['taxonomyNodes'],
    promptFiles: ['attribute-extraction', 'attribute-extraction-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.3', description: 'Slightly creative for attribute generation' },
      { name: '-BatchSize', type: 'number', default: '5', description: 'Nodes processed per API call' },
      { name: '-Force', type: 'switch', default: 'false', description: 'Re-extract even if attributes exist' },
    ],
  },
  {
    id: 'ps-edge-discovery',
    title: 'Edge Discovery',
    description: 'Discovers typed, directed edges between taxonomy nodes to build the knowledge graph.',
    source: 'AITriad/Prompts/edge-discovery.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-EdgeDiscovery. Analyzes pairs of taxonomy nodes and proposes AIF-aligned edges (SUPPORTS, CONTRADICTS, ASSUMES, etc.) with confidence scores and rationale.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
    promptFiles: ['edge-discovery', 'edge-discovery-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for edge discovery' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
      { name: '-BatchSize', type: 'number', default: '5', description: 'Node pairs processed per API call' },
    ],
  },
  {
    id: 'ps-fallacy-analysis',
    title: 'Fallacy Analysis',
    description: 'Examines taxonomy nodes to identify potential logical fallacies in their reasoning.',
    source: 'AITriad/Prompts/fallacy-analysis.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-FallacyAnalysis. Identifies possible fallacies with tiered classification (formal, informal_structural, informal_contextual, cognitive_bias) and confidence levels.',
    applicableDataSources: ['taxonomyNodes'],
    promptFiles: ['fallacy-analysis', 'fallacy-analysis-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for fallacy analysis' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
      { name: '-BatchSize', type: 'number', default: '5', description: 'Nodes processed per API call' },
    ],
  },
  {
    id: 'ps-graph-query',
    title: 'Graph Query',
    description: 'Natural language questions translated into graph-traversal reasoning via LLM.',
    source: 'AITriad/Prompts/graph-query.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-GraphQuery. Translates natural language questions into structured graph traversal, finding relevant nodes, edges, and paths through the taxonomy.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
    promptFiles: ['graph-query', 'graph-query-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for graph queries' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
    ],
  },
  {
    id: 'ps-metadata-extraction',
    title: 'Metadata Extraction',
    description: 'Extracts structured metadata (title, authors, date, topics) from ingested documents.',
    source: 'AITriad/Prompts/metadata-extraction.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Import-AITriadDocument. Extracts structured metadata from source documents during ingestion: title, authors, publication date, abstract, topic tags, POV tags.',
    applicableDataSources: ['sourceDocument'],
    promptFiles: ['metadata-extraction'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for metadata extraction' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
    ],
  },
  {
    id: 'ps-taxonomy-proposal',
    title: 'Taxonomy Proposal',
    description: 'Proposes new taxonomy nodes based on analysis of source material and existing taxonomy gaps.',
    source: 'AITriad/Prompts/taxonomy-proposal.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Invoke-TaxonomyProposal. Analyzes a source document against the existing taxonomy and proposes new nodes to fill coverage gaps, with genus-differentia descriptions and BDI categorization.',
    applicableDataSources: ['sourceDocument', 'taxonomyNodes', 'situationNodes'],
    promptFiles: ['taxonomy-proposal'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for taxonomy proposals' },
      { name: '-Temperature', type: 'number', default: '0.3', description: 'Slightly creative for proposal generation' },
    ],
  },
  {
    id: 'ps-situation-candidates',
    title: 'Situation Candidates',
    description: 'Evaluates clusters of similar nodes from different POVs as candidates for new situation nodes.',
    source: 'AITriad/Prompts/situation-candidates.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Find-SituationCandidates. Finds clusters of nodes from different POVs that address the same concept, and evaluates whether they should become new situation nodes with per-POV interpretations.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
    promptFiles: ['situation-candidates', 'situation-candidates-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for situation analysis' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
      { name: '-MinSimilarity', type: 'number', default: '0.7', description: 'Minimum cosine similarity threshold for candidate clusters' },
    ],
  },
  {
    id: 'ps-ingestion-priority',
    title: 'Ingestion Priority',
    description: 'Scores and ranks research gaps — orphans, one-sided conflicts, echo chambers, coverage imbalance.',
    source: 'AITriad/Prompts/ingestion-priority.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Get-IngestionPriority. Analyzes taxonomy health metrics to identify where new source documents would have the most impact: orphaned nodes, one-sided conflicts, POV imbalances.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
    promptFiles: ['ingestion-priority'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model to use for priority scoring' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature (0-2)' },
    ],
  },
  {
    id: 'ps-topic-frequency-label',
    title: 'Topic Frequency Labeling',
    description: 'Labels thematic clusters identified by topic frequency analysis across the taxonomy.',
    source: 'AITriad/Prompts/topic-frequency-label.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used for topic analysis. Generates human-readable labels for clusters identified by word frequency and co-occurrence analysis across taxonomy node descriptions.',
    applicableDataSources: ['taxonomyNodes'],
    promptFiles: ['topic-frequency-label'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.1', description: 'Sampling temperature' },
    ],
  },
  {
    id: 'ps-triad-dialogue-system',
    title: 'Triad Dialogue: System',
    description: 'System prompt for the three debate agents (Prometheus, Sentinel, Cassandra) in structured triad dialogues.',
    source: 'AITriad/Prompts/triad-dialogue-system.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Show-TriadDialogue. Sets up the three legacy debate agents with their POV personas, behavioral constraints, and steelmanning requirements. The PowerShell predecessor to the Electron debate feature.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'vulnerabilities'],
    promptFiles: ['triad-dialogue-system', 'triad-dialogue-schema'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.7', description: 'Higher creativity for dialogue' },
      { name: '-Rounds', type: 'number', default: '3', description: 'Number of debate rounds' },
    ],
  },
  {
    id: 'ps-triad-dialogue-turn',
    title: 'Triad Dialogue: Turn',
    description: 'Generates a single debate turn for a triad dialogue agent, incorporating prior context.',
    source: 'AITriad/Prompts/triad-dialogue-turn.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Show-TriadDialogue. Generates one turn for a triad dialogue agent, incorporating the debate transcript so far and the agent\'s taxonomy context.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes', 'vulnerabilities'],
    promptFiles: ['triad-dialogue-turn'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.7', description: 'Higher creativity for dialogue' },
    ],
  },
  {
    id: 'ps-triad-dialogue-synthesis',
    title: 'Triad Dialogue: Synthesis',
    description: 'Synthesizes a completed triad dialogue into areas of agreement, disagreement, and open questions.',
    source: 'AITriad/Prompts/triad-dialogue-synthesis.prompt',
    template: '(Loading from disk...)',
    group: 'powershell',
    purpose: 'Used by Show-TriadDialogue. Produces a structured synthesis of a completed PowerShell triad dialogue: agreements, disagreements, and questions for further research.',
    applicableDataSources: ['taxonomyNodes', 'situationNodes'],
    promptFiles: ['triad-dialogue-synthesis'],
    psParameters: [
      { name: '-Model', type: 'string', default: 'gemini-3.1-flash-lite-preview', description: 'AI model' },
      { name: '-Temperature', type: 'number', default: '0.3', description: 'Lower creativity for synthesis' },
    ],
  },
];
