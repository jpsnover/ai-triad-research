// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  DebateSession,
  DebateSessionSummary,
  DebateSourceType,
  PoverId,
  TranscriptEntry,
  TaxonomyRef,
} from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PovNode, CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from './useTaxonomyStore';
import { mapErrorToUserMessage } from '../utils/errorMessages';
import { formatTaxonomyContext } from '../utils/taxonomyContext';
import type { TaxonomyContext } from '../utils/taxonomyContext';
import { extractClaimsPrompt, classifyClaimsPrompt, formatArgumentNetworkContext, formatCommitments } from '../prompts/argumentNetwork';
import type { ArgumentNetworkNode, ArgumentNetworkEdge, CommitmentStore, EntryDiagnostics, DebateDiagnostics } from '../types/debate';
import { scoreNodeRelevance, selectRelevantNodes, selectRelevantCCNodes, buildRelevanceQuery } from '../utils/taxonomyRelevance';
import {
  clarificationPrompt,
  crossCuttingClarificationPrompt,
  documentClarificationPrompt,
  formatCrossCuttingDebateContext,
  synthesisPrompt,
  openingStatementPrompt,
  debateResponsePrompt,
  crossRespondSelectionPrompt,
  crossRespondPrompt,
  debateSynthesisPrompt,
  probingQuestionsPrompt,
  factCheckPrompt,
  contextCompressionPrompt,
} from '../prompts/debate';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Read the model for the current debate context.
 *  Priority: debate-specific override > global Settings model > default */
function getConfiguredModel(): string {
  // Check debate-specific model first
  const debateModel = useDebateStore.getState().debateModel;
  if (debateModel) return debateModel;
  try {
    return localStorage.getItem('taxonomy-editor-gemini-model') || 'gemini-3.1-flash-lite-preview';
  } catch {
    return 'gemini-3.1-flash-lite-preview';
  }
}

/** Call generateText with progress tracking — subscribes to onGenerateTextProgress */
async function generateTextWithProgress(
  prompt: string,
  model: string,
  activity: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
): Promise<{ text: string }> {
  set({ debateActivity: activity, debateProgress: null });
  const unsubscribe = window.electronAPI.onGenerateTextProgress((progress: Record<string, unknown>) => {
    set({ debateProgress: progress });
  });
  try {
    const result = await window.electronAPI.generateText(prompt, model);
    return result;
  } finally {
    unsubscribe();
    set({ debateProgress: null, debateActivity: null });
  }
}

/**
 * Guard against race conditions in async debate operations.
 * Captures the active debate ID at call time; returns a checker that
 * verifies the debate hasn't changed during an await.
 */
function createDebateGuard(get: () => { activeDebateId: string | null }): () => boolean {
  const capturedId = get().activeDebateId;
  return () => {
    if (capturedId !== get().activeDebateId) {
      console.warn(`[debate] Active debate changed during async operation (was ${capturedId}, now ${get().activeDebateId}). Discarding stale results.`);
      return false;
    }
    return true;
  };
}

/** Strip markdown code fences from LLM responses */
function stripCodeFences(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
}

const AI_POVER_ORDER: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];

/** Record diagnostic data for a transcript entry (only when diagnostics enabled) */
function recordDiagnostic(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  entryId: string,
  data: Partial<EntryDiagnostics>,
): void {
  if (!get().diagnosticsEnabled) return;
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const diag: DebateDiagnostics = debate.diagnostics || {
    enabled: true,
    entries: {},
    overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
  };

  diag.entries[entryId] = { ...diag.entries[entryId], ...data };

  // Update overview counters
  if (data.response_time_ms) {
    diag.overview.total_ai_calls++;
    diag.overview.total_response_time_ms += data.response_time_ms;
  }

  const updatedDebate = { ...debate, diagnostics: diag };
  set({ activeDebate: updatedDebate });

  // Broadcast to popout window
  try { window.electronAPI.sendDiagnosticsState({ debate: updatedDebate, selectedEntry: get().selectedDiagEntry }); } catch { /* ignore */ }
}

/**
 * Extract claims from a debater's statement and update the argument network.
 * Runs in the background after each turn — does not block the debate flow.
 */
async function extractClaimsAndUpdateAN(
  statement: string,
  speaker: PoverId,
  entryId: string,
  taxonomyRefs: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: () => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: (partial: any) => void,
  debaterClaims?: { claim: string; targets: string[] }[],
): Promise<void> {
  const debate = get().activeDebate as DebateSession | null;
  if (!debate) return;

  const model = getConfiguredModel();
  const an = debate.argument_network || { nodes: [], edges: [] };
  const priorClaims = an.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker }));
  const speakerLabel = POVER_INFO[speaker as Exclude<PoverId, 'user'>]?.label || speaker;

  try {
    // Hybrid approach: if debater supplied claims, use classifyClaimsPrompt (lighter).
    // Otherwise fall back to full extractClaimsPrompt (backward compat with older models).
    const prompt = debaterClaims && debaterClaims.length > 0
      ? classifyClaimsPrompt(statement, speakerLabel, debaterClaims, priorClaims)
      : extractClaimsPrompt(statement, speakerLabel, priorClaims);
    const { text } = await window.electronAPI.generateText(prompt, model);
    let cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cleaned = cleaned.slice(fb, lb + 1);
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

    const parsed = JSON.parse(cleaned) as { claims?: { text: string; responds_to?: { prior_claim_id: string; relationship: string; attack_type?: string; scheme?: string; warrant?: string }[] }[] };
    if (!parsed.claims || !Array.isArray(parsed.claims)) return;

    const turnNumber = debate.transcript.length;
    const newNodes: ArgumentNetworkNode[] = [];
    const newEdges: ArgumentNetworkEdge[] = [];
    const priorIds = new Set(an.nodes.map(n => n.id));
    let nextId = an.nodes.length + 1;
    const diagAccepted: { text: string; id: string; overlap_pct: number }[] = [];
    const diagRejected: { text: string; reason: string; overlap_pct: number }[] = [];

    // Commitments tracking
    const commitments = debate.commitments || {};
    const speakerCommits: CommitmentStore = commitments[speaker] || { asserted: [], conceded: [], challenged: [] };

    for (const claim of parsed.claims.slice(0, 4)) {
      if (!claim.text || claim.text.length < 10) continue;

      // V1.4: Verify claim is grounded in statement (>40% word overlap)
      const claimWords = new Set(claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const stmtWords = new Set(statement.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const overlap = [...claimWords].filter(w => stmtWords.has(w)).length / Math.max(claimWords.size, 1);
      if (overlap < 0.3) {
        console.warn(`[AN] Rejected claim — low overlap (${(overlap * 100).toFixed(0)}%): ${claim.text.slice(0, 60)}`);
        diagRejected.push({ text: claim.text, reason: `Low word overlap (${(overlap * 100).toFixed(0)}%)`, overlap_pct: Math.round(overlap * 100) });
        continue;
      }

      const nodeId = `AN-${nextId++}`;
      newNodes.push({
        id: nodeId,
        text: claim.text,
        speaker,
        source_entry_id: entryId,
        taxonomy_refs: taxonomyRefs,
        turn_number: turnNumber,
      });

      // Track as asserted
      speakerCommits.asserted.push(claim.text);
      diagAccepted.push({ text: claim.text, id: nodeId, overlap_pct: Math.round(overlap * 100) });

      for (const resp of claim.responds_to || []) {
        // V1.4: Verify prior claim exists
        if (!priorIds.has(resp.prior_claim_id)) {
          console.warn(`[AN] Skipped reference to nonexistent ${resp.prior_claim_id}`);
          continue;
        }

        const edgeId = `AE-${an.edges.length + newEdges.length + 1}`;
        const edge: ArgumentNetworkEdge = {
          id: edgeId,
          source: nodeId,
          target: resp.prior_claim_id,
          type: resp.relationship === 'attacks' ? 'attacks' : 'supports',
          warrant: resp.warrant || undefined,
        };
        if (resp.relationship === 'attacks') {
          edge.attack_type = (resp.attack_type as 'rebut' | 'undercut' | 'undermine') || 'rebut';
          edge.scheme = resp.scheme || undefined;
          // Track as challenged
          const targetNode = an.nodes.find(n => n.id === resp.prior_claim_id);
          if (targetNode) speakerCommits.challenged.push(targetNode.text);
        }
        if (resp.scheme === 'CONCEDE') {
          // Track as conceded
          const targetNode = an.nodes.find(n => n.id === resp.prior_claim_id);
          if (targetNode) speakerCommits.conceded.push(targetNode.text);
        }
        newEdges.push(edge);
      }
    }

    if (newNodes.length === 0) return;

    // Update debate session
    const updated = {
      ...get().activeDebate,
      argument_network: {
        nodes: [...an.nodes, ...newNodes],
        edges: [...an.edges, ...newEdges],
      },
      commitments: {
        ...commitments,
        [speaker]: speakerCommits,
      },
    };
    set({ activeDebate: updated });
    await get().saveDebate();

    console.log(`[AN] Extracted ${newNodes.length} claims, ${newEdges.length} edges from ${speakerLabel}'s turn`);

    // Record claim extraction diagnostics
    recordDiagnostic(get, set, entryId, {
      extracted_claims: { accepted: diagAccepted, rejected: diagRejected },
    });

    // Broadcast updated state to popout
    try { window.electronAPI.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry }); } catch { /* ignore */ }
  } catch (err) {
    console.warn('[AN] Claim extraction failed (non-blocking):', err);
  }
}

// ── Taxonomy grounding helpers ───────────────────────────

/** Get taxonomy data from the taxonomy store for a given POV */
function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();

  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const crossCuttingNodes: CrossCuttingNode[] = state.crossCutting?.nodes ?? [];

  return { povNodes, crossCuttingNodes };
}

// Cache for node embeddings (loaded once per session)
let _nodeEmbeddingsCache: Record<string, { pov: string; vector: number[] }> | null = null;

/** Load node embeddings from the data repo (cached) */
async function loadNodeEmbeddings(): Promise<Record<string, { pov: string; vector: number[] }>> {
  if (_nodeEmbeddingsCache) return _nodeEmbeddingsCache;
  try {
    const raw = await window.electronAPI.loadEdges(); // Reuse the data loading path
    // Actually we need a separate IPC — but for now, use computeEmbeddings as a fallback
    // The embeddings are in the file but not exposed via IPC. Fall back to null.
    return {};
  } catch {
    return {};
  }
}

/**
 * Get taxonomy context filtered by relevance to the debate topic.
 * Falls back to unfiltered if embeddings unavailable.
 */
async function getRelevantTaxonomyContext(
  pov: string,
  topic: string,
  recentTranscript: string,
  threshold: number = 0.3,
): Promise<TaxonomyContext> {
  const state = useTaxonomyStore.getState();
  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const allPovNodes: PovNode[] = povFile?.nodes ?? [];
  const allCCNodes: CrossCuttingNode[] = state.crossCutting?.nodes ?? [];

  try {
    // Build query from debate context
    const query = buildRelevanceQuery(topic, recentTranscript);

    // Get query embedding
    const { vector: queryVector } = await window.electronAPI.computeQueryEmbedding(query);

    // Get embeddings for all POV nodes
    const nodeTexts = allPovNodes.map(n => `${n.label}: ${n.description}`);
    const nodeIds = allPovNodes.map(n => n.id);
    const { vectors } = await window.electronAPI.computeEmbeddings(nodeTexts, nodeIds);

    // Build scores map
    const scores = new Map<string, number>();
    for (let i = 0; i < nodeIds.length; i++) {
      const dot = queryVector.reduce((s, v, j) => s + v * vectors[i][j], 0);
      const normQ = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0));
      const normN = Math.sqrt(vectors[i].reduce((s, v) => s + v * v, 0));
      scores.set(nodeIds[i], normQ > 0 && normN > 0 ? dot / (normQ * normN) : 0);
    }

    // Also score CC nodes
    const ccTexts = allCCNodes.map(n => `${n.label}: ${n.description}`);
    const ccIds = allCCNodes.map(n => n.id);
    if (ccTexts.length > 0) {
      const { vectors: ccVectors } = await window.electronAPI.computeEmbeddings(ccTexts, ccIds);
      for (let i = 0; i < ccIds.length; i++) {
        const dot = queryVector.reduce((s, v, j) => s + v * ccVectors[i][j], 0);
        const normQ = Math.sqrt(queryVector.reduce((s, v) => s + v * v, 0));
        const normN = Math.sqrt(ccVectors[i].reduce((s, v) => s + v * v, 0));
        scores.set(ccIds[i], normQ > 0 && normN > 0 ? dot / (normQ * normN) : 0);
      }
    }

    const filteredPov = selectRelevantNodes(allPovNodes, scores, threshold);
    const filteredCC = selectRelevantCCNodes(allCCNodes, scores, threshold);

    console.log(`[taxonomy] Relevance-filtered: ${filteredPov.length} POV nodes (from ${allPovNodes.length}), ${filteredCC.length} CC nodes (from ${allCCNodes.length})`);

    return { povNodes: filteredPov, crossCuttingNodes: filteredCC };
  } catch (err) {
    console.warn('[taxonomy] Relevance scoring failed, using unfiltered:', err);
    // Fallback: first 21 POV nodes + first 10 CC nodes
    return {
      povNodes: allPovNodes.slice(0, 21),
      crossCuttingNodes: allCCNodes.slice(0, 10),
    };
  }
}

/** Format relevant edges between active debaters' nodes for the moderator */
function formatEdgeContext(activePovers: string[]): string {
  const edgesFile = useTaxonomyStore.getState().edgesFile;
  if (!edgesFile?.edges) return '';

  // Map pover labels to POV prefixes
  const povPrefixes: Record<string, string> = {
    accelerationist: 'acc-', safetyist: 'saf-', skeptic: 'skp-',
  };
  const labelToPov: Record<string, string> = {
    Prometheus: 'accelerationist', Sentinel: 'safetyist', Cassandra: 'skeptic',
  };

  // Find cross-POV edges of high-signal types
  const signalTypes = new Set(['CONTRADICTS', 'TENSION_WITH', 'WEAKENS', 'RESPONDS_TO']);
  const activePovs = activePovers.map(l => labelToPov[l]).filter(Boolean);
  const activePrefixes = activePovs.map(p => povPrefixes[p]).filter(Boolean);

  const relevantEdges = edgesFile.edges.filter(e => {
    if (!signalTypes.has(e.type)) return false;
    if (e.status !== 'approved' && e.confidence < 0.75) return false;
    // Must be cross-POV
    const srcPrefix = activePrefixes.find(p => e.source.startsWith(p));
    const tgtPrefix = activePrefixes.find(p => e.target.startsWith(p));
    return srcPrefix && tgtPrefix && srcPrefix !== tgtPrefix;
  });

  if (relevantEdges.length === 0) return '';

  // Take top edges by confidence
  const top = relevantEdges
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);

  const lines = ['', '=== KNOWN TENSIONS BETWEEN POSITIONS ==='];
  for (const e of top) {
    lines.push(`${e.source} ${e.type} ${e.target} (confidence: ${e.confidence.toFixed(2)})`);
  }
  return lines.join('\n');
}

// ── Prompt builders (delegate to prompts/debate.ts) ──────

function buildClarificationPrompt(topic: string, sourceContent?: string): string {
  return clarificationPrompt(topic, sourceContent);
}

function buildSynthesisPrompt(
  originalTopic: string,
  clarifications: { speaker: string; questions: string[]; answers: string }[],
): string {
  let qaPairs = '';
  for (const c of clarifications) {
    qaPairs += `\n${c.speaker} asked:\n`;
    for (const q of c.questions) qaPairs += `  - ${q}\n`;
    qaPairs += `User answered: ${c.answers}\n`;
  }
  return synthesisPrompt(originalTopic, qaPairs);
}

function buildOpeningStatementPrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  priorStatements: { speaker: string; statement: string }[],
  sourceContent?: string,
  length: string = 'medium',
): string {
  const info = POVER_INFO[poverId];
  let priorBlock = '';
  if (priorStatements.length > 0) {
    priorBlock = '\n\n=== PRIOR OPENING STATEMENTS ===\n';
    for (const ps of priorStatements) {
      priorBlock += `\n${ps.speaker}:\n${ps.statement}\n`;
    }
  }
  return openingStatementPrompt(info.label, info.pov, info.personality, topic, taxonomyContext, priorBlock, priorStatements.length === 0, sourceContent, length);
}

function buildDebateResponsePrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  question: string,
  addressing: string,
  sourceContent?: string,
  length: string = 'medium',
): string {
  const info = POVER_INFO[poverId];
  return debateResponsePrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, question, addressing, sourceContent, length);
}

function buildCrossRespondSelectionPrompt(
  recentTranscript: string,
  activePovers: string[],
  argumentNetwork?: { nodes: ArgumentNetworkNode[]; edges: ArgumentNetworkEdge[] },
): string {
  const edgeContext = formatEdgeContext(activePovers);
  const anContext = argumentNetwork
    ? formatArgumentNetworkContext(
        argumentNetwork.nodes.map(n => ({ id: n.id, text: n.text, speaker: POVER_INFO[n.speaker as Exclude<PoverId, 'user'>]?.label || n.speaker })),
        argumentNetwork.edges,
      )
    : '';
  return crossRespondSelectionPrompt(recentTranscript, activePovers, edgeContext + anContext);
}

function buildCrossRespondPrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  focusPoint: string,
  addressing: string,
  length: string = 'medium',
  sourceContent?: string,
): string {
  const info = POVER_INFO[poverId];
  return crossRespondPrompt(info.label, info.pov, info.personality, topic, taxonomyContext, recentTranscript, focusPoint, addressing, length, sourceContent);
}

function buildDebateSynthesisPrompt(
  topic: string,
  transcript: string,
  hasSourceDocument: boolean = false,
): string {
  return debateSynthesisPrompt(topic, transcript, hasSourceDocument);
}

function buildProbingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
  hasSourceDocument: boolean = false,
): string {
  return probingQuestionsPrompt(topic, transcript, unreferencedNodes, hasSourceDocument);
}

function buildFactCheckPrompt(
  selectedText: string,
  statementContext: string,
  taxonomyNodes: string,
  conflictData: string,
): string {
  return factCheckPrompt(selectedText, statementContext, taxonomyNodes, conflictData);
}

function buildContextCompressionPrompt(
  entries: string,
): string {
  return contextCompressionPrompt(entries);
}

/** Parse @-mentions from user input. Returns { target, cleanedInput } */
function parseAtMention(input: string): { targets: PoverId[]; cleanedInput: string } {
  const mentionMap: Record<string, PoverId> = {
    prometheus: 'prometheus',
    sentinel: 'sentinel',
    cassandra: 'cassandra',
  };

  const targets: PoverId[] = [];
  let remaining = input;

  // Extract all leading @mentions
  while (true) {
    const match = remaining.match(/^@(\w+)[,:]?\s*/i);
    if (!match) break;
    const name = match[1].toLowerCase();
    const target = mentionMap[name];
    if (target && !targets.includes(target)) {
      targets.push(target);
      remaining = remaining.slice(match[0].length);
    } else {
      break;
    }
  }

  return { targets, cleanedInput: remaining };
}

/** Format recent transcript entries for inclusion in prompts.
 *  When context summaries exist, prepends the latest summary for compressed history. */
function formatRecentTranscript(
  transcript: TranscriptEntry[],
  maxEntries: number = 8,
  contextSummaries?: { up_to_entry_id: string; summary: string }[],
): string {
  const recent = transcript.filter((e) => e.type !== 'system').slice(-maxEntries);
  if (recent.length === 0) return '(No prior exchanges)';

  const parts: string[] = [];

  // Prepend the latest context summary if available
  if (contextSummaries && contextSummaries.length > 0) {
    const latest = contextSummaries[contextSummaries.length - 1];
    parts.push(`[Earlier debate summary]: ${latest.summary}`);
  }

  for (const e of recent) {
    const label = e.speaker === 'user' ? 'Moderator'
      : e.speaker === 'system' ? 'System'
      : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label || e.speaker;
    const typeTag = e.type === 'question' ? ' [question]' : e.type === 'opening' ? ' [opening]' : '';
    parts.push(`${label}${typeTag}: ${e.content}`);
  }

  return parts.join('\n\n');
}

/** Extended metadata from enriched debate prompts */
interface PoverResponseMeta {
  move_types?: string[];
  disagreement_type?: string;
  key_assumptions?: { assumption: string; if_wrong: string }[];
  my_claims?: { claim: string; targets: string[] }[];
}

/** Parse a POVer response JSON from the LLM */
function parsePoverResponse(text: string): { statement: string; taxonomyRefs: TaxonomyRef[]; meta: PoverResponseMeta } {
  let statement: string;
  let taxonomyRefs: TaxonomyRef[] = [];
  let meta: PoverResponseMeta = {};

  try {
    const parsed = JSON.parse(stripCodeFences(text));
    statement = parsed.statement || text.trim();
    if (Array.isArray(parsed.taxonomy_refs)) {
      taxonomyRefs = parsed.taxonomy_refs
        .filter((r: Record<string, unknown>) => r.node_id && typeof r.node_id === 'string')
        .map((r: Record<string, unknown>) => ({
          node_id: r.node_id as string,
          relevance: (r.relevance as string) || '',
        }));
    }
    // Capture enriched debate metadata
    meta = {
      move_types: Array.isArray(parsed.move_types) ? parsed.move_types : undefined,
      disagreement_type: typeof parsed.disagreement_type === 'string' ? parsed.disagreement_type : undefined,
      key_assumptions: Array.isArray(parsed.key_assumptions) ? parsed.key_assumptions : undefined,
      my_claims: Array.isArray(parsed.my_claims) ? parsed.my_claims.filter(
        (c: Record<string, unknown>) => typeof c.claim === 'string' && Array.isArray(c.targets),
      ) : undefined,
    };
  } catch {
    statement = text.trim();
  }

  return { statement, taxonomyRefs, meta };
}

// ── Store interface ──────────────────────────────────────

interface DebateStore {
  // Session list
  sessions: DebateSessionSummary[];
  sessionsLoading: boolean;

  // Active debate
  activeDebateId: string | null;
  activeDebate: DebateSession | null;
  debateLoading: boolean;
  debateGenerating: PoverId | null;
  debateError: string | null;
  responseLength: 'brief' | 'medium' | 'detailed';
  setResponseLength: (length: 'brief' | 'medium' | 'detailed') => void;
  debateProgress: { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string } | null;
  debateActivity: string | null; // human-readable description of what's happening
  inspectedNodeId: string | null; // Phase 6: node currently shown in pane 3
  debateModel: string | null; // debate-specific model override (null = use global)
  diagnosticsEnabled: boolean;
  selectedDiagEntry: string | null; // transcript entry ID selected for diagnostics
  diagPopoutOpen: boolean;

  // Actions
  toggleDiagnostics: () => void;
  selectDiagEntry: (entryId: string | null) => void;
  setDiagPopoutOpen: (open: boolean) => void;
  inspectNode: (nodeId: string | null) => void;
  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: PoverId[], userIsPover: boolean, sourceType?: DebateSourceType, sourceRef?: string, sourceContent?: string, debateModel?: string, protocolId?: string) => Promise<string>;
  createCrossCuttingDebate: (ccNodeId: string) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  deleteDebate: (id: string) => Promise<void>;
  renameDebate: (id: string, newTitle: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => void;
  deleteTranscriptEntries: (entryIds: string[]) => Promise<void>;
  togglePover: (poverId: PoverId) => Promise<void>;
  updatePhase: (phase: DebateSession['phase']) => void;
  updateTopic: (topic: Partial<DebateSession['topic']>) => void;
  saveDebate: () => Promise<void>;
  setGenerating: (pover: PoverId | null) => void;
  setError: (error: string | null) => void;

  // Phase 2: Clarification
  runClarification: () => Promise<void>;
  submitAnswersAndSynthesize: (answers: string) => Promise<void>;
  beginDebate: () => Promise<void>;

  // Phase 3: Opening Statements
  openingOrder: Exclude<PoverId, 'user'>[];
  setOpeningOrder: (order: Exclude<PoverId, 'user'>[]) => void;
  runOpeningStatements: () => Promise<void>;
  submitUserOpening: (statement: string) => Promise<void>;

  // Phase 4: Main Debate Loop
  askQuestion: (input: string) => Promise<void>;
  crossRespond: () => Promise<void>;

  // Phase 5: Synthesis & Probing
  requestSynthesis: () => Promise<void>;
  requestProbingQuestions: () => Promise<void>;

  // Phase 7: Fact Check
  factCheckSelection: (selectedText: string, entryId: string) => Promise<void>;

  // Phase 8: Context Window Management
  compressOldTranscript: () => Promise<void>;
}

export const useDebateStore = create<DebateStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeDebateId: null,
  activeDebate: null,
  debateLoading: false,
  debateGenerating: null,
  responseLength: 'medium',
  setResponseLength: (length) => set({ responseLength: length }),
  openingOrder: [],
  setOpeningOrder: (order) => set({ openingOrder: order }),
  debateError: null,
  debateProgress: null,
  debateActivity: null,
  inspectedNodeId: null,
  debateModel: null,
  diagnosticsEnabled: false,
  selectedDiagEntry: null,
  diagPopoutOpen: false,

  toggleDiagnostics: () => {
    const enabled = !get().diagnosticsEnabled;
    set({ diagnosticsEnabled: enabled });
    // Broadcast to popout
    try { window.electronAPI.sendDiagnosticsState({ debate: get().activeDebate, selectedEntry: get().selectedDiagEntry }); } catch { /* ignore */ }
    // Initialize diagnostics on the active debate if enabling
    if (enabled && get().activeDebate && !get().activeDebate!.diagnostics) {
      const updated = {
        ...get().activeDebate!,
        diagnostics: {
          enabled: true,
          entries: {},
          overview: { total_ai_calls: 0, total_response_time_ms: 0, claims_accepted: 0, claims_rejected: 0, move_type_counts: {}, disagreement_type_counts: {} },
        },
      };
      set({ activeDebate: updated });
    }
  },

  selectDiagEntry: (entryId) => {
    set({ selectedDiagEntry: entryId });
    // Broadcast to popout diagnostics window
    try {
      const debate = get().activeDebate;
      window.electronAPI.sendDiagnosticsState({ debate, selectedEntry: entryId });
    } catch { /* popout may not exist */ }
  },

  setDiagPopoutOpen: (open) => set({ diagPopoutOpen: open }),

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await window.electronAPI.listDebateSessions();
      set({ sessions: raw as DebateSessionSummary[], sessionsLoading: false });
    } catch {
      set({ sessionsLoading: false });
    }
  },

  createDebate: async (topic, povers, userIsPover, sourceType = 'topic', sourceRef = '', sourceContent = '', debateModel, protocolId) => {
    const id = generateId();
    const now = nowISO();
    const title = topic.length > 60 ? topic.slice(0, 57) + '...' : topic;
    const session: DebateSession = {
      id,
      title,
      created_at: now,
      updated_at: now,
      phase: 'setup',
      topic: {
        original: topic,
        refined: null,
        final: topic,
      },
      source_type: sourceType,
      source_ref: sourceRef,
      source_content: sourceContent,
      active_povers: povers,
      user_is_pover: userIsPover,
      transcript: [],
      context_summaries: [],
      generated_with_prompt_version: 'dolce-phase-1',
      debate_model: debateModel || undefined,
      protocol_id: protocolId || 'structured',
    };
    await window.electronAPI.saveDebateSession(session);
    set({ activeDebateId: id, activeDebate: session, debateModel: debateModel || null });
    await get().loadSessions();
    return id;
  },

  createCrossCuttingDebate: async (ccNodeId: string) => {
    const taxState = useTaxonomyStore.getState();
    const ccNode = taxState.crossCutting?.nodes.find(n => n.id === ccNodeId);
    if (!ccNode) throw new Error(`Cross-cutting node ${ccNodeId} not found`);

    // Resolve linked node descriptions
    const linkedNodeDescriptions: string[] = [];
    for (const linkedId of ccNode.linked_nodes) {
      for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
        const file = taxState[pov];
        const node = file?.nodes.find(n => n.id === linkedId);
        if (node) {
          linkedNodeDescriptions.push(`[${node.id}] ${node.label}: ${node.description}`);
          break;
        }
      }
    }

    // Resolve conflict summaries
    const conflictSummaries: string[] = [];
    for (const conflictId of ccNode.conflict_ids) {
      const conflict = taxState.conflicts.find(c => c.claim_id === conflictId);
      if (conflict) {
        const stances = conflict.instances.map(i => `${i.doc_id}: ${i.stance}`).join('; ');
        conflictSummaries.push(`[${conflict.claim_id}] ${conflict.claim_label} — ${conflict.description} (${stances})`);
      }
    }

    const attrs = ccNode.graph_attributes as Record<string, unknown> | undefined;
    const sourceContent = formatCrossCuttingDebateContext({
      id: ccNode.id,
      label: ccNode.label,
      description: ccNode.description,
      interpretations: ccNode.interpretations,
      assumes: attrs?.assumes as string[] | undefined,
      steelmanVulnerability: attrs?.steelman_vulnerability as string | undefined,
      possibleFallacies: attrs?.possible_fallacies as { fallacy: string; confidence: string; explanation: string }[] | undefined,
      linkedNodeDescriptions,
      conflictSummaries,
    });

    const topic = ccNode.label;
    const allPovers: PoverId[] = ['prometheus', 'sentinel', 'cassandra'];

    const id = await get().createDebate(topic, allPovers, false, 'cross-cutting', ccNodeId, sourceContent);
    await get().loadDebate(id);
    get().updatePhase('clarification');
    await get().saveDebate();
    return id;
  },

  loadDebate: async (id) => {
    set({ debateLoading: true, debateError: null });
    try {
      const raw = await window.electronAPI.loadDebateSession(id);
      const session = raw as DebateSession;
      set({ activeDebateId: id, activeDebate: session, debateLoading: false, debateModel: session.debate_model || null });
    } catch (err) {
      set({ debateLoading: false, debateError: mapErrorToUserMessage(err) });
    }
  },

  deleteDebate: async (id) => {
    try {
      await window.electronAPI.deleteDebateSession(id);
      const { activeDebateId } = get();
      if (activeDebateId === id) {
        set({ activeDebateId: null, activeDebate: null, debateModel: null });
      }
      await get().loadSessions();
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  renameDebate: async (id, newTitle) => {
    try {
      const raw = await window.electronAPI.loadDebateSession(id);
      const session = raw as DebateSession;
      session.title = newTitle;
      session.updated_at = nowISO();
      await window.electronAPI.saveDebateSession(session);
      // Update active debate if it's the one being renamed
      if (get().activeDebateId === id) {
        set({ activeDebate: session });
      }
      await get().loadSessions();
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  closeDebate: () => {
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateGenerating: null, debateModel: null });
  },

  addTranscriptEntry: (entry) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    const full: TranscriptEntry = {
      ...entry,
      id: generateId(),
      timestamp: nowISO(),
    };
    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: [...activeDebate.transcript, full],
    };
    set({ activeDebate: updated });
  },

  deleteTranscriptEntries: async (entryIds) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;
    const idsToRemove = new Set(entryIds);
    const filtered = activeDebate.transcript.filter(e => !idsToRemove.has(e.id));
    const updated: DebateSession = {
      ...activeDebate,
      updated_at: nowISO(),
      transcript: filtered,
    };
    set({ activeDebate: updated });
    await saveDebate();
  },

  togglePover: async (poverId) => {
    const { activeDebate, saveDebate } = get();
    if (!activeDebate) return;
    const current = activeDebate.active_povers;
    let updated: PoverId[];
    if (current.includes(poverId)) {
      // Remove — but must keep at least 2
      updated = current.filter(p => p !== poverId);
      if (updated.filter(p => p !== 'user').length < 1) return; // Need at least 1 AI pover
    } else {
      // Add
      updated = [...current, poverId];
    }
    const newDebate: DebateSession = {
      ...activeDebate,
      active_povers: updated,
      updated_at: nowISO(),
    };
    set({ activeDebate: newDebate });
    await saveDebate();
  },

  updatePhase: (phase) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({ activeDebate: { ...activeDebate, phase, updated_at: nowISO() } });
  },

  updateTopic: (topic) => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    set({
      activeDebate: {
        ...activeDebate,
        topic: { ...activeDebate.topic, ...topic },
        updated_at: nowISO(),
      },
    });
  },

  saveDebate: async () => {
    const { activeDebate } = get();
    if (!activeDebate) return;
    try {
      await window.electronAPI.saveDebateSession(activeDebate);
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === activeDebate.id
            ? { ...s, title: activeDebate.title, updated_at: activeDebate.updated_at, phase: activeDebate.phase }
            : s,
        ),
      }));
    } catch (err) {
      set({ debateError: mapErrorToUserMessage(err) });
    }
  },

  setGenerating: (pover) => set({ debateGenerating: pover }),
  inspectNode: (nodeId) => set({ inspectedNodeId: nodeId }),
  setError: (error) => set({ debateError: error }),

  // ── Phase 2: Clarification ──────────────────────────────

  runClarification: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate, debateGenerating } = get();
    if (!activeDebate) return;

    // Guard: don't run if already generating or if clarification already exists
    if (debateGenerating) return;
    if (activeDebate.transcript.some(e => e.type === 'clarification')) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    set({ debateGenerating: 'system' as PoverId });
    const prompt = activeDebate.source_type === 'cross-cutting'
      ? crossCuttingClarificationPrompt(topic, activeDebate.source_content)
      : (activeDebate.source_type === 'document' || activeDebate.source_type === 'url')
        ? documentClarificationPrompt(topic, activeDebate.source_content)
        : buildClarificationPrompt(topic, activeDebate.source_content || undefined);
    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating clarifying questions (${model})`, set);
      if (!isStillValid()) return;
      let questions: string[];
      try {
        const parsed = JSON.parse(stripCodeFences(text));
        questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [];
      } catch {
        questions = [text.trim()];
      }
      if (questions.length > 0) {
        addTranscriptEntry({
          type: 'clarification',
          speaker: 'system',
          content: questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
          taxonomy_refs: [],
          metadata: { questions },
        });
      }
    } catch (err) {
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `Failed to generate clarifying questions: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
    }

    set({ debateGenerating: null });
    get().updatePhase('clarification');
    await saveDebate();
  },

  submitAnswersAndSynthesize: async (answers: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);

    addTranscriptEntry({
      type: 'answer',
      speaker: 'user',
      content: answers,
      taxonomy_refs: [],
    });

    set({ debateError: null, debateGenerating: 'system' as PoverId });

    const clarifications: { speaker: string; questions: string[]; answers: string }[] = [];
    const clarEntries = get().activeDebate!.transcript.filter((e) => e.type === 'clarification');
    for (const entry of clarEntries) {
      const qs = (entry.metadata?.questions as string[]) || [entry.content];
      clarifications.push({
        speaker: POVER_INFO[entry.speaker as Exclude<PoverId, 'user'>]?.label || entry.speaker,
        questions: qs,
        answers,
      });
    }

    const model = getConfiguredModel();
    const prompt = buildSynthesisPrompt(activeDebate.topic.original, clarifications);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Synthesizing refined topic (${model})`, set);
      if (!isStillValid()) return;
      let refinedTopic: string;
      try {
        const parsed = JSON.parse(stripCodeFences(text));
        refinedTopic = parsed.refined_topic || text.trim();
      } catch {
        refinedTopic = text.trim();
      }

      get().updateTopic({ refined: refinedTopic, final: refinedTopic });

      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `Refined topic: "${refinedTopic}"`,
        taxonomy_refs: [],
        metadata: { refined_topic: refinedTopic },
      });
    } catch (err) {
      set({ debateError: `Topic synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },

  beginDebate: async () => {
    const { activeDebate, updatePhase, saveDebate, addTranscriptEntry } = get();
    updatePhase('opening');

    // Initialize opening order with a random shuffle of active AI POVers
    if (activeDebate) {
      const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
      const shuffled = [...aiPovers];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      set({ openingOrder: shuffled });
    }

    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: 'The debate begins. Opening statements will follow.',
      taxonomy_refs: [],
    });
    await saveDebate();
  },

  // ── Phase 3: Opening Statements ─────────────────────────

  runOpeningStatements: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Use the user-configurable opening order (randomized at beginDebate)
    const { openingOrder } = get();
    const aiPovers = openingOrder.length > 0
      ? openingOrder.filter((p) => activeDebate.active_povers.includes(p))
      : AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    // Collect prior statements as we go (sequential — each sees the ones before it)
    const priorStatements: { speaker: string; statement: string }[] = [];

    for (const poverId of aiPovers) {
      set({ debateGenerating: poverId });

      const info = POVER_INFO[poverId];
      const recentText = priorStatements.map(ps => ps.statement).join('\n').slice(-500);
      const ctx = await getRelevantTaxonomyContext(info.pov, topic, recentText);
      const speakerClaims = (get().activeDebate?.argument_network?.nodes || []).filter(n => n.speaker === poverId);
      const commitBlock = formatCommitments(
        get().activeDebate?.commitments?.[poverId] || { asserted: [], conceded: [], challenged: [] },
        speakerClaims,
      );
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + commitBlock;

      const prompt = buildOpeningStatementPrompt(poverId, topic, taxonomyBlock, priorStatements, activeDebate.source_content || undefined, get().responseLength);

      try {
        const t0 = Date.now();
        const { text } = await generateTextWithProgress(prompt, model, `${info.label} is preparing opening statement (${model})`, set);
        const responseTime = Date.now() - t0;
        if (!isStillValid()) return;
        const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

        const entryForAN = {
          type: 'opening' as const,
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          metadata: { ...meta },
        };
        addTranscriptEntry(entryForAN);
        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];

        // Record diagnostics
        if (lastEntry) {
          recordDiagnostic(get, set, lastEntry.id, {
            prompt: prompt.slice(0, 15000),
            raw_response: text.slice(0, 5000),
            model,
            response_time_ms: responseTime,
            taxonomy_context: taxonomyBlock.slice(0, 5000),
            commitment_context: commitBlock || undefined,
          });
          // Record move types in overview
          if (meta.move_types && get().diagnosticsEnabled) {
            const diag = get().activeDebate?.diagnostics;
            if (diag) {
              for (const m of meta.move_types) diag.overview.move_type_counts[m] = (diag.overview.move_type_counts[m] || 0) + 1;
              if (meta.disagreement_type) diag.overview.disagreement_type_counts[meta.disagreement_type] = (diag.overview.disagreement_type_counts[meta.disagreement_type] || 0) + 1;
            }
          }
        }

        priorStatements.push({ speaker: info.label, statement });

        // Save after each statement so progress persists
        await saveDebate();

        // Extract claims in background (non-blocking)
        if (lastEntry) {
          extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
        }
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to deliver opening statement: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      }
    }

    set({ debateGenerating: null });

    // If user is a POVer, wait for their input (phase stays 'opening')
    // Otherwise, transition to debate phase
    if (!activeDebate.user_is_pover) {
      get().updatePhase('debate');
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: 'Opening statements complete. The floor is open.',
        taxonomy_refs: [],
      });
    }

    await saveDebate();
  },

  submitUserOpening: async (statement: string) => {
    const { addTranscriptEntry, updatePhase, saveDebate } = get();

    addTranscriptEntry({
      type: 'opening',
      speaker: 'user',
      content: statement,
      taxonomy_refs: [],
    });

    updatePhase('debate');

    addTranscriptEntry({
      type: 'system',
      speaker: 'system',
      content: 'Opening statements complete. The floor is open.',
      taxonomy_refs: [],
    });

    await saveDebate();
  },

  // ── Phase 4: Main Debate Loop ────────────────────────────

  askQuestion: async (input: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate || !input.trim()) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null });

    // Parse @-mentions to determine targets
    const { targets, cleanedInput } = parseAtMention(input);

    // Validate targets are active POVers
    for (const t of targets) {
      if (!activeDebate.active_povers.includes(t)) {
        const label = t === 'user' ? 'You' : POVER_INFO[t as Exclude<PoverId, 'user'>]?.label || t;
        set({ debateError: `${label} is not in this debate` });
        return;
      }
    }

    // Add user's question to transcript
    addTranscriptEntry({
      type: 'question',
      speaker: 'user',
      content: input,
      taxonomy_refs: [],
      addressing: targets.length === 1 ? targets[0] : 'all',
    });

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Determine which AI POVers should respond
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
    const respondingPovers = targets.length > 0
      ? aiPovers.filter((p) => targets.includes(p)) // Targeted: only mentioned POVers
      : aiPovers; // All active AI POVers

    if (respondingPovers.length === 0) {
      // User targeted themselves or no AI POVers — nothing to generate
      await saveDebate();
      return;
    }

    const recentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);

    // Generate responses sequentially so each sees prior responses
    for (const poverId of respondingPovers) {
      set({ debateGenerating: poverId });

      const info = POVER_INFO[poverId];
      const currentTranscriptForRelevance = formatRecentTranscript(get().activeDebate!.transcript, 4, get().activeDebate!.context_summaries);
      const ctx = await getRelevantTaxonomyContext(info.pov, topic, currentTranscriptForRelevance);
      const speakerClaims = (get().activeDebate?.argument_network?.nodes || []).filter(n => n.speaker === poverId);
      const commitBlock = formatCommitments(
        get().activeDebate?.commitments?.[poverId] || { asserted: [], conceded: [], challenged: [] },
        speakerClaims,
      );
      const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + commitBlock;

      // Use the most current transcript (includes responses from prior POVers in this round)
      const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);

      const prompt = buildDebateResponsePrompt(
        poverId,
        topic,
        taxonomyBlock,
        currentTranscript,
        cleanedInput,
        targets.length > 0 ? poverId : 'all',
        activeDebate.source_content || undefined,
        get().responseLength,
      );

      try {
        const { text } = await generateTextWithProgress(prompt, model, `${POVER_INFO[poverId].label} is responding (${model})`, set);
        if (!isStillValid()) return;
        const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

        addTranscriptEntry({
          type: 'statement',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          addressing: 'user',
          metadata: { ...meta },
        });

        const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
        if (lastEntry) {
          extractClaimsAndUpdateAN(statement, poverId, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
        }
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to respond: ${mapErrorToUserMessage(err)}`,
          taxonomy_refs: [],
        });
      }
    }

    set({ debateGenerating: null });
    await saveDebate();
  },

  crossRespond: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null });

    // Lazy-load edges for moderator context
    const taxState = useTaxonomyStore.getState();
    if (!taxState.edgesFile) {
      await useTaxonomyStore.getState().loadEdges();
    }

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    if (aiPovers.length < 2) {
      set({ debateError: 'Need at least 2 AI debaters for cross-response' });
      return;
    }

    const recentTranscript = formatRecentTranscript(activeDebate.transcript, 8, activeDebate.context_summaries);
    const poverLabels = aiPovers.map((p) => POVER_INFO[p].label);

    // Step 1: Ask the LLM which POVer should respond to whom
    set({ debateGenerating: aiPovers[0] }); // Show some activity

    const selectionPrompt = buildCrossRespondSelectionPrompt(recentTranscript, poverLabels, activeDebate.argument_network);

    let responderPover: Exclude<PoverId, 'user'> | null = null;
    let focusPoint = '';
    let addressingLabel = 'general';

    try {
      const { text } = await generateTextWithProgress(selectionPrompt, model, `Selecting next responder (${model})`, set);
      if (!isStillValid()) return;
      try {
        const parsed = JSON.parse(stripCodeFences(text));

        // Map the label back to a PoverId
        const responderName = (parsed.responder || '').toLowerCase();
        responderPover = aiPovers.find((p) =>
          POVER_INFO[p].label.toLowerCase() === responderName,
        ) ?? null;

        focusPoint = parsed.focus_point || '';
        addressingLabel = parsed.addressing || 'general';

        // If agreement detected, add a system note and stop
        if (parsed.agreement_detected) {
          addTranscriptEntry({
            type: 'system',
            speaker: 'system',
            content: `The debaters appear to be in agreement on this point. ${focusPoint ? `Consider exploring: ${focusPoint}` : 'Try asking a new question to push the debate further.'}`,
            taxonomy_refs: [],
          });
          set({ debateGenerating: null });
          await saveDebate();
          return;
        }
      } catch {
        // Fallback: pick the POVer who spoke least recently
        const lastSpeaker = [...activeDebate.transcript].reverse().find(
          (e) => e.type === 'statement' || e.type === 'opening',
        )?.speaker;
        responderPover = aiPovers.find((p) => p !== lastSpeaker) ?? aiPovers[0];
        focusPoint = 'the most recent points raised in the debate';
      }
    } catch (err) {
      set({ debateError: `Cross-respond selection failed: ${mapErrorToUserMessage(err)}`, debateGenerating: null });
      return;
    }

    if (!responderPover) {
      responderPover = aiPovers[0];
    }

    // Step 2: Generate the cross-response
    set({ debateGenerating: responderPover });

    const info = POVER_INFO[responderPover];
    const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript, 8, get().activeDebate!.context_summaries);
    const ctx = await getRelevantTaxonomyContext(info.pov, topic, currentTranscript);
    const speakerClaims = (activeDebate.argument_network?.nodes || []).filter(n => n.speaker === responderPover);
    const commitBlock = formatCommitments(
      activeDebate.commitments?.[responderPover] || { asserted: [], conceded: [], challenged: [] },
      speakerClaims,
    );
    const taxonomyBlock = formatTaxonomyContext(ctx, info.pov) + commitBlock;

    const prompt = buildCrossRespondPrompt(
      responderPover,
      topic,
      taxonomyBlock,
      currentTranscript,
      focusPoint,
      addressingLabel,
      get().responseLength,
      activeDebate.source_content || undefined,
    );

    try {
      const { text } = await generateTextWithProgress(prompt, model, `${info.label} is cross-responding (${model})`, set);
      if (!isStillValid()) return;
      const { statement, taxonomyRefs, meta } = parsePoverResponse(text);

      addTranscriptEntry({
        type: 'statement',
        speaker: responderPover,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        addressing: 'all',
        metadata: { cross_respond: true, focus_point: focusPoint, addressing_label: addressingLabel, ...meta },
      });

      const lastEntry = get().activeDebate?.transcript.slice(-1)[0];
      if (lastEntry) {
        extractClaimsAndUpdateAN(statement, responderPover, lastEntry.id, taxonomyRefs.map(r => r.node_id), get, set, meta.my_claims);
      }
    } catch (err) {
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `${info.label} failed to cross-respond: ${mapErrorToUserMessage(err)}`,
        taxonomy_refs: [],
      });
    }

    set({ debateGenerating: null });
    await saveDebate();
  },

  // ── Phase 5: Synthesis & Probing ──────────────────────────

  requestSynthesis: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateGenerating: 'system' as PoverId });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildDebateSynthesisPrompt(activeDebate.topic.final, fullTranscript, hasSourceDoc);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating synthesis (${model})`, set);
      if (!isStillValid()) return;

      let synthesis;
      try {
        synthesis = JSON.parse(stripCodeFences(text));
      } catch {
        synthesis = { areas_of_agreement: [], areas_of_disagreement: [], unresolved_questions: [text.trim()], taxonomy_coverage: [] };
      }

      // Build readable content
      const lines: string[] = [];
      if (synthesis.areas_of_agreement?.length > 0) {
        lines.push('**Areas of Agreement:**');
        for (const a of synthesis.areas_of_agreement) {
          const who = Array.isArray(a.povers) ? a.povers.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ') : '';
          lines.push(`- ${a.point}${who ? ` (${who})` : ''}`);
        }
      }
      if (synthesis.areas_of_disagreement?.length > 0) {
        lines.push('', '**Areas of Disagreement:**');
        for (const d of synthesis.areas_of_disagreement) {
          const typeTag = d.type ? ` [${d.type}]` : '';
          const bdiTag = d.bdi_layer ? ` {${d.bdi_layer}}` : '';
          lines.push(`- ${d.point}${typeTag}${bdiTag}`);
          if (d.resolvability) {
            lines.push(`  *Resolution path: ${d.resolvability.replace(/_/g, ' ')}*`);
          }
          if (Array.isArray(d.positions)) {
            for (const pos of d.positions) {
              const label = POVER_INFO[pos.pover as Exclude<PoverId, 'user'>]?.label || pos.pover;
              lines.push(`  - ${label}: ${pos.stance}`);
            }
          }
        }
      }
      if (synthesis.cruxes?.length > 0) {
        lines.push('', '**Cruxes (mind-changing questions):**');
        for (const c of synthesis.cruxes) {
          const typeTag = c.type ? ` [${c.type}]` : '';
          lines.push(`- ${c.question}${typeTag}`);
          if (c.if_yes) lines.push(`  - If yes: ${c.if_yes}`);
          if (c.if_no) lines.push(`  - If no: ${c.if_no}`);
        }
      }
      if (synthesis.document_claims?.length > 0) {
        lines.push('', '**Document Claims:**');
        for (const dc of synthesis.document_claims) {
          const accepted = Array.isArray(dc.accepted_by)
            ? dc.accepted_by.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ')
            : '';
          const challenged = Array.isArray(dc.challenged_by)
            ? dc.challenged_by.map((p: string) => POVER_INFO[p as Exclude<PoverId, 'user'>]?.label || p).join(', ')
            : '';
          lines.push(`- ${dc.claim}`);
          if (accepted) lines.push(`  - Accepted by: ${accepted}`);
          if (challenged) lines.push(`  - Challenged by: ${challenged}${dc.challenge_basis ? ` — ${dc.challenge_basis}` : ''}`);
        }
      }
      if (synthesis.argument_map?.length > 0) {
        lines.push('', '**Argument Map:**');
        for (const claim of synthesis.argument_map) {
          const claimantLabel = POVER_INFO[claim.claimant as Exclude<PoverId, 'user'>]?.label || claim.claimant;
          const typeTag = claim.type ? ` [${claim.type}]` : '';
          lines.push(`- **${claim.claim_id}** (${claimantLabel})${typeTag}: ${claim.claim}`);
          if (claim.supported_by?.length > 0) {
            for (const sup of claim.supported_by) {
              if (typeof sup === 'string') {
                lines.push(`  Supported by: ${sup}`);
              } else {
                const schemeTag = sup.scheme ? ` (${sup.scheme.replace(/_/g, ' ')})` : '';
                lines.push(`  Supported by ${sup.claim_id}${schemeTag}${sup.warrant ? `: ${sup.warrant}` : ''}`);
              }
            }
          }
          if (claim.attacked_by?.length > 0) {
            for (const attack of claim.attacked_by) {
              const attackerLabel = POVER_INFO[attack.claimant as Exclude<PoverId, 'user'>]?.label || attack.claimant;
              const schemeTag = attack.scheme ? ` via ${attack.scheme}` : '';
              lines.push(`  ← **${attack.claim_id}** ${attack.attack_type}${schemeTag} (${attackerLabel}): ${attack.claim}`);
            }
          }
        }
      }
      if (synthesis.preferences?.length > 0) {
        lines.push('', '**Resolution Analysis:**');
        for (const p of synthesis.preferences) {
          if (p.prevails === 'undecidable') {
            lines.push(`- **${p.conflict}** — Undecidable`);
            lines.push(`  *${p.rationale}*`);
          } else {
            lines.push(`- **${p.conflict}** — Stronger: ${p.prevails} (${p.criterion?.replace(/_/g, ' ')})`);
            lines.push(`  *${p.rationale}*`);
          }
          if (p.what_would_change_this) {
            lines.push(`  Would change if: ${p.what_would_change_this}`);
          }
        }
      }
      if (synthesis.unresolved_questions?.length > 0) {
        lines.push('', '**Unresolved Questions:**');
        for (const q of synthesis.unresolved_questions) {
          lines.push(`- ${q}`);
        }
      }

      const taxonomyCoverage: TaxonomyRef[] = (synthesis.taxonomy_coverage || [])
        .filter((t: Record<string, unknown>) => t.node_id)
        .map((t: Record<string, unknown>) => ({ node_id: t.node_id as string, relevance: (t.how_used as string) || '' }));

      addTranscriptEntry({
        type: 'synthesis',
        speaker: 'system',
        content: lines.join('\n'),
        taxonomy_refs: taxonomyCoverage,
        metadata: { synthesis },
      });
    } catch (err) {
      set({ debateError: `Synthesis failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },

  requestProbingQuestions: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    const isStillValid = createDebateGuard(get);
    set({ debateError: null, debateGenerating: 'system' as PoverId });

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
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
      const ctx = getTaxonomyContext(pov);
      for (const n of ctx.povNodes) allNodeIds.push(`[${n.id}] ${n.label}`);
    }
    const ccCtx = getTaxonomyContext('accelerationist'); // cross-cutting is the same from any POV
    for (const n of ccCtx.crossCuttingNodes) allNodeIds.push(`[${n.id}] ${n.label}`);

    const unreferenced = allNodeIds.filter((desc) => {
      const match = desc.match(/^\[([^\]]+)\]/);
      return match && !referencedNodes.has(match[1]);
    }).slice(0, 20); // Limit to keep prompt reasonable

    const hasSourceDoc = activeDebate.source_type === 'document' || activeDebate.source_type === 'url';
    const prompt = buildProbingQuestionsPrompt(activeDebate.topic.final, fullTranscript, unreferenced, hasSourceDoc);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating probing questions (${model})`, set);
      if (!isStillValid()) return;

      let questions: { text: string; targets: string[] }[] = [];
      try {
        const parsed = JSON.parse(stripCodeFences(text));
        questions = Array.isArray(parsed.questions) ? parsed.questions : [];
      } catch {
        questions = [{ text: text.trim(), targets: [] }];
      }

      addTranscriptEntry({
        type: 'probing',
        speaker: 'system',
        content: questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n'),
        taxonomy_refs: [],
        metadata: { probing_questions: questions },
      });
    } catch (err) {
      set({ debateError: `Probing questions failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
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
    set({ debateError: null, debateGenerating: 'system' as PoverId });

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
    for (const pov of ['accelerationist', 'safetyist', 'skeptic'] as const) {
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
    set({ debateActivity: `Searching the web for evidence (${model})` });
    let webContext = '';
    let searchQueries: string[] = [];
    try {
      const searchResult = await window.electronAPI.generateTextWithSearch(
        `Fact-check this claim from an AI policy debate. Find recent, authoritative sources that support or contradict it. Be specific about what evidence you found.\n\nClaim: "${selectedText}"\n\nContext: ${statementContext.slice(0, 500)}`,
        model,
      );
      webContext = searchResult.text;
      searchQueries = searchResult.searchQueries || [];
    } catch (err) {
      console.warn('[factCheck] Web search failed, proceeding with internal data only:', err);
      webContext = '(Web search unavailable)';
    }
    if (!isStillValid()) return;

    // Step 2: Run main fact-check with all evidence
    const prompt = buildFactCheckPrompt(
      selectedText,
      statementContext,
      allNodes.join('\n'),
      conflictLines.slice(0, 15).join('\n') + (webContext ? `\n\n=== WEB SEARCH RESULTS ===\n${webContext}` : ''),
    );

    try {
      set({ debateActivity: `Analyzing evidence (${model})` });
      const { text } = await generateTextWithProgress(prompt, model, `Fact-checking claim (${model})`, set);
      if (!isStillValid()) return;

      let result;
      try {
        result = JSON.parse(stripCodeFences(text));
      } catch {
        result = { verdict: 'unverifiable', explanation: text.trim(), sources: [] };
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
        content: `**Fact Check: ${verdictLabels[result.verdict] || result.verdict}**\n\n"${selectedText.length > 120 ? selectedText.slice(0, 117) + '...' : selectedText}"\n\n${result.explanation}${webNote}`,
        taxonomy_refs: sourceRefs,
        metadata: {
          fact_check: {
            verdict: result.verdict,
            explanation: result.explanation,
            sources: result.sources,
            checked_text: selectedText,
            web_search_used: webContext !== '(Web search unavailable)',
            web_search_queries: searchQueries,
            web_search_evidence: webContext !== '(Web search unavailable)' ? webContext : undefined,
          },
        },
      });
    } catch (err) {
      set({ debateError: `Fact check failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
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
    set({ debateError: null, debateGenerating: 'system' as PoverId });

    const model = getConfiguredModel();
    const entriesText = toCompress.map((e) => {
      const label = e.speaker === 'user' ? 'Moderator'
        : e.speaker === 'system' ? 'System'
        : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label || e.speaker;
      return `${label} [${e.type}]: ${e.content}`;
    }).join('\n\n');

    const prompt = buildContextCompressionPrompt(entriesText);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Compressing debate history (${model})`, set);
      if (!isStillValid()) return;

      let summary: string;
      try {
        const parsed = JSON.parse(stripCodeFences(text));
        summary = parsed.summary || text.trim();
      } catch {
        summary = text.trim();
      }

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

      await saveDebate();
    } catch (err) {
      set({ debateError: `Context compression failed: ${mapErrorToUserMessage(err)}` });
    } finally {
      set({ debateGenerating: null });
    }
  },
}));

/** Helper to get node label for fact check (standalone, no React hooks) */
function getNodeLabelForFactCheck(nodeId: string): string {
  const state = useTaxonomyStore.getState();
  if (nodeId.startsWith('cc-')) {
    const node = state.crossCutting?.nodes?.find((n: { id: string }) => n.id === nodeId);
    return node?.label || nodeId;
  }
  const povMap: Record<string, string> = { 'acc-': 'accelerationist', 'saf-': 'safetyist', 'skp-': 'skeptic' };
  for (const [prefix, pov] of Object.entries(povMap)) {
    if (nodeId.startsWith(prefix)) {
      const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
      const node = povFile?.nodes?.find((n: { id: string }) => n.id === nodeId);
      return node?.label || nodeId;
    }
  }
  return nodeId;
}
