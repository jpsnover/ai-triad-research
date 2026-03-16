// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import type {
  DebateSession,
  DebateSessionSummary,
  PoverId,
  TranscriptEntry,
  TaxonomyRef,
} from '../types/debate';
import { POVER_INFO } from '../types/debate';
import type { PovNode, CrossCuttingNode } from '../types/taxonomy';
import { useTaxonomyStore } from './useTaxonomyStore';

function generateId(): string {
  return crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Read the model the user has configured in taxonomy-editor Settings */
function getConfiguredModel(): string {
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

/** Strip markdown code fences from LLM responses */
function stripCodeFences(text: string): string {
  return text.replace(/```json\s*/g, '').replace(/```/g, '').trim();
}

const AI_POVER_ORDER: Exclude<PoverId, 'user'>[] = ['prometheus', 'sentinel', 'cassandra'];

// ── Taxonomy grounding helpers ───────────────────────────

interface TaxonomyContext {
  povNodes: PovNode[];
  crossCuttingNodes: CrossCuttingNode[];
}

/** Get taxonomy data from the taxonomy store for a given POV */
function getTaxonomyContext(pov: string): TaxonomyContext {
  const state = useTaxonomyStore.getState();

  const povFile = state[pov as 'accelerationist' | 'safetyist' | 'skeptic'];
  const povNodes: PovNode[] = povFile?.nodes ?? [];
  const crossCuttingNodes: CrossCuttingNode[] = state.crossCutting?.nodes ?? [];

  return { povNodes, crossCuttingNodes };
}

/** Format taxonomy nodes into a concise context block for the LLM prompt */
function formatTaxonomyContext(ctx: TaxonomyContext, maxNodes: number = 20): string {
  // Include up to maxNodes POV nodes + all cross-cutting (usually ~15)
  const povSlice = ctx.povNodes.slice(0, maxNodes);
  const lines: string[] = ['=== YOUR TAXONOMY POSITIONS ==='];

  for (const n of povSlice) {
    lines.push(`[${n.id}] ${n.label}: ${n.description}`);
  }

  if (ctx.crossCuttingNodes.length > 0) {
    lines.push('', '=== CROSS-CUTTING CONCERNS ===');
    for (const n of ctx.crossCuttingNodes) {
      lines.push(`[${n.id}] ${n.label}: ${n.description}`);
    }
  }

  return lines.join('\n');
}

// ── Prompt builders ──────────────────────────────────────

function buildClarificationPrompt(poverId: Exclude<PoverId, 'user'>, topic: string): string {
  const info = POVER_INFO[poverId];
  return `You are ${info.label}, an AI debater representing the ${info.pov} perspective on AI policy.
Your personality: ${info.personality}.

A user wants to debate the following topic:

"${topic}"

Ask 1-3 clarifying questions that would help you make the strongest possible argument from your perspective. Your questions should:
- Help narrow the scope so you can give a focused argument
- Surface assumptions the user might not realize they're making
- Be concise (one sentence each)

Respond ONLY with a JSON object in this exact format (no markdown, no code fences):
{"questions": ["question 1", "question 2"]}`;
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

  return `A debate moderator proposed this topic:

"${originalTopic}"

Several debaters asked clarifying questions and the moderator answered:
${qaPairs}

Synthesize the original topic and the answers into a clear, specific debate topic statement.
One to three sentences. Incorporate the key constraints and scope clarifications from the answers.

Respond ONLY with a JSON object (no markdown, no code fences):
{"refined_topic": "the refined topic statement"}`;
}

function buildOpeningStatementPrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  priorStatements: { speaker: string; statement: string }[],
): string {
  const info = POVER_INFO[poverId];

  let priorBlock = '';
  if (priorStatements.length > 0) {
    priorBlock = '\n\n=== PRIOR OPENING STATEMENTS ===\n';
    for (const ps of priorStatements) {
      priorBlock += `\n${ps.speaker}:\n${ps.statement}\n`;
    }
  }

  return `You are ${info.label}, an AI debater representing the ${info.pov} perspective on AI policy.
Your personality: ${info.personality}.

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field.

${taxonomyContext}
${priorBlock}

The debate topic is:

"${topic}"

Deliver your opening statement. This is your chance to frame the issue from your perspective and establish your core argument. Be specific, substantive, and persuasive. 2-4 paragraphs.

${priorStatements.length > 0 ? 'You have read the prior opening statements. You may reference or contrast with them, but focus on your own position.' : 'You are delivering the first opening statement.'}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your opening statement text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
  ]
}`;
}

// ── Phase 4 prompt builders ──────────────────────────────

function buildDebateResponsePrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  question: string,
  addressing: string,
): string {
  const info = POVER_INFO[poverId];

  return `You are ${info.label}, an AI debater representing the ${info.pov} perspective on AI policy.
Your personality: ${info.personality}.

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words. Never say "According to taxonomy node X" — instead, make the argument naturally and tag which nodes you drew from in the taxonomy_refs field.

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== ${addressing === 'all' ? 'QUESTION TO THE PANEL' : `QUESTION DIRECTED AT YOU`} ===
${question}

Respond from your perspective. Be specific, substantive, and engage with the debate history. Reference points made by other debaters when relevant. 1-3 paragraphs.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
  ]
}`;
}

function buildCrossRespondSelectionPrompt(
  recentTranscript: string,
  activePovers: string[],
): string {
  return `You are a debate moderator analyzing the current state of a structured debate.

=== RECENT DEBATE EXCHANGE ===
${recentTranscript}

=== ACTIVE DEBATERS ===
${activePovers.join(', ')}

Identify the most productive next exchange. Which debater should respond, to whom, and about what specific point? Choose the response that would most disambiguate the current disagreement or surface a new dimension.

If all debaters seem to be in agreement, say so and suggest what angle could be explored next.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "responder": "debater name who should speak next",
  "addressing": "debater name they should address, or 'general'",
  "focus_point": "the specific point or question they should address",
  "agreement_detected": false
}`;
}

function buildCrossRespondPrompt(
  poverId: Exclude<PoverId, 'user'>,
  topic: string,
  taxonomyContext: string,
  recentTranscript: string,
  focusPoint: string,
  addressing: string,
): string {
  const info = POVER_INFO[poverId];

  return `You are ${info.label}, an AI debater representing the ${info.pov} perspective on AI policy.
Your personality: ${info.personality}.

Your taxonomy positions inform your worldview. Reference them when relevant but express ideas in your own words.

${taxonomyContext}

=== DEBATE TOPIC ===
"${topic}"

=== RECENT DEBATE HISTORY ===
${recentTranscript}

=== YOUR ASSIGNMENT ===
Address ${addressing === 'general' ? 'the panel' : addressing} on this point: ${focusPoint}

Respond substantively. Engage directly with what was said. If you disagree, explain why with specifics. If you agree on some points, say so and push further. 1-3 paragraphs.

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "statement": "your response text",
  "taxonomy_refs": [
    {"node_id": "e.g. acc-goals-002", "relevance": "brief note on how this informed your argument"}
  ]
}`;
}

// ── Phase 5 prompt builders ──────────────────────────────

function buildDebateSynthesisPrompt(
  topic: string,
  transcript: string,
): string {
  return `You are a debate analyst. Analyze this structured debate and produce a synthesis.

=== DEBATE TOPIC ===
"${topic}"

=== FULL TRANSCRIPT ===
${transcript}

Identify:
1. Areas where the debaters agree (and which debaters)
2. Areas where they genuinely disagree (with each debater's specific stance)
3. Questions that remain unresolved
4. Which taxonomy nodes were referenced and how they were used

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "areas_of_agreement": [{"point": "...", "povers": ["prometheus", "sentinel"]}],
  "areas_of_disagreement": [{"point": "...", "positions": [{"pover": "prometheus", "stance": "..."}, {"pover": "sentinel", "stance": "..."}]}],
  "unresolved_questions": ["..."],
  "taxonomy_coverage": [{"node_id": "e.g. acc-goals-002", "how_used": "brief description"}]
}`;
}

function buildProbingQuestionsPrompt(
  topic: string,
  transcript: string,
  unreferencedNodes: string[],
): string {
  const unreferencedBlock = unreferencedNodes.length > 0
    ? `\n\n=== TAXONOMY NODES NOT YET REFERENCED ===\n${unreferencedNodes.join('\n')}`
    : '';

  return `You are a debate facilitator. Given this debate, suggest 3-5 probing questions that would advance the discussion. Prioritize questions that would:
- Surface genuine disagreement or expose unstated assumptions
- Push debaters beyond their comfort zones
- ${unreferencedNodes.length > 0 ? 'Explore taxonomy areas not yet discussed' : 'Deepen the current lines of argument'}

=== DEBATE TOPIC ===
"${topic}"

=== TRANSCRIPT ===
${transcript}
${unreferencedBlock}

Respond ONLY with a JSON object (no markdown, no code fences):
{
  "questions": [
    {"text": "the probing question", "targets": ["prometheus", "sentinel"]}
  ]
}`;
}

/** Parse @-mentions from user input. Returns { target, cleanedInput } */
function parseAtMention(input: string): { target: PoverId | null; cleanedInput: string } {
  const mentionMap: Record<string, PoverId> = {
    prometheus: 'prometheus',
    sentinel: 'sentinel',
    cassandra: 'cassandra',
  };

  const match = input.match(/^@(\w+)[,:]?\s*/i);
  if (match) {
    const name = match[1].toLowerCase();
    const target = mentionMap[name] ?? null;
    if (target) {
      return { target, cleanedInput: input.slice(match[0].length) };
    }
  }
  return { target: null, cleanedInput: input };
}

/** Format recent transcript entries for inclusion in prompts */
function formatRecentTranscript(transcript: TranscriptEntry[], maxEntries: number = 8): string {
  const recent = transcript.filter((e) => e.type !== 'system').slice(-maxEntries);
  if (recent.length === 0) return '(No prior exchanges)';

  return recent.map((e) => {
    const label = e.speaker === 'user' ? 'Moderator'
      : e.speaker === 'system' ? 'System'
      : POVER_INFO[e.speaker as Exclude<PoverId, 'user'>]?.label || e.speaker;
    const typeTag = e.type === 'question' ? ' [question]' : e.type === 'opening' ? ' [opening]' : '';
    return `${label}${typeTag}: ${e.content}`;
  }).join('\n\n');
}

/** Parse a POVer response JSON from the LLM */
function parsePoverResponse(text: string): { statement: string; taxonomyRefs: TaxonomyRef[] } {
  let statement: string;
  let taxonomyRefs: TaxonomyRef[] = [];

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
  } catch {
    statement = text.trim();
  }

  return { statement, taxonomyRefs };
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
  debateProgress: { attempt: number; maxRetries: number; backoffSeconds?: number; limitType?: string; limitMessage?: string } | null;
  debateActivity: string | null; // human-readable description of what's happening

  // Actions
  loadSessions: () => Promise<void>;
  createDebate: (topic: string, povers: PoverId[], userIsPover: boolean) => Promise<string>;
  loadDebate: (id: string) => Promise<void>;
  deleteDebate: (id: string) => Promise<void>;
  closeDebate: () => void;
  addTranscriptEntry: (entry: Omit<TranscriptEntry, 'id' | 'timestamp'>) => void;
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
  runOpeningStatements: () => Promise<void>;
  submitUserOpening: (statement: string) => Promise<void>;

  // Phase 4: Main Debate Loop
  askQuestion: (input: string) => Promise<void>;
  crossRespond: () => Promise<void>;

  // Phase 5: Synthesis & Probing
  requestSynthesis: () => Promise<void>;
  requestProbingQuestions: () => Promise<void>;
}

export const useDebateStore = create<DebateStore>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  activeDebateId: null,
  activeDebate: null,
  debateLoading: false,
  debateGenerating: null,
  debateError: null,
  debateProgress: null,
  debateActivity: null,

  loadSessions: async () => {
    set({ sessionsLoading: true });
    try {
      const raw = await window.electronAPI.listDebateSessions();
      set({ sessions: raw as DebateSessionSummary[], sessionsLoading: false });
    } catch {
      set({ sessionsLoading: false });
    }
  },

  createDebate: async (topic, povers, userIsPover) => {
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
      active_povers: povers,
      user_is_pover: userIsPover,
      transcript: [],
      context_summaries: [],
    };
    await window.electronAPI.saveDebateSession(session);
    set({ activeDebateId: id, activeDebate: session });
    await get().loadSessions();
    return id;
  },

  loadDebate: async (id) => {
    set({ debateLoading: true, debateError: null });
    try {
      const raw = await window.electronAPI.loadDebateSession(id);
      const session = raw as DebateSession;
      set({ activeDebateId: id, activeDebate: session, debateLoading: false });
    } catch (err) {
      set({ debateLoading: false, debateError: String(err) });
    }
  },

  deleteDebate: async (id) => {
    try {
      await window.electronAPI.deleteDebateSession(id);
      const { activeDebateId } = get();
      if (activeDebateId === id) {
        set({ activeDebateId: null, activeDebate: null });
      }
      await get().loadSessions();
    } catch (err) {
      set({ debateError: String(err) });
    }
  },

  closeDebate: () => {
    set({ activeDebateId: null, activeDebate: null, debateError: null, debateGenerating: null });
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
      set({ debateError: String(err) });
    }
  },

  setGenerating: (pover) => set({ debateGenerating: pover }),
  setError: (error) => set({ debateError: error }),

  // ── Phase 2: Clarification ──────────────────────────────

  runClarification: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    set({ debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    // Fire all clarification requests in parallel
    const promises = aiPovers.map(async (poverId) => {
      set({ debateGenerating: poverId });
      const prompt = buildClarificationPrompt(poverId, topic);
      try {
        const { text } = await generateTextWithProgress(prompt, model, `${POVER_INFO[poverId].label} is formulating questions (${model})`, set);
        let questions: string[];
        try {
          const parsed = JSON.parse(stripCodeFences(text));
          questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        } catch {
          questions = [text.trim()];
        }
        if (questions.length > 0) {
          return { poverId, questions };
        }
        return null;
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${POVER_INFO[poverId].label} failed to generate questions: ${String(err)}`,
          taxonomy_refs: [],
        });
        return null;
      }
    });

    const results = await Promise.all(promises);
    set({ debateGenerating: null });

    for (const r of results) {
      if (r) {
        addTranscriptEntry({
          type: 'clarification',
          speaker: r.poverId,
          content: r.questions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
          taxonomy_refs: [],
          metadata: { questions: r.questions },
        });
      }
    }

    get().updatePhase('clarification');
    await saveDebate();
  },

  submitAnswersAndSynthesize: async (answers: string) => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    addTranscriptEntry({
      type: 'answer',
      speaker: 'user',
      content: answers,
      taxonomy_refs: [],
    });

    set({ debateError: null, debateGenerating: 'prometheus' });

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
      set({ debateError: `Topic synthesis failed: ${String(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },

  beginDebate: async () => {
    const { updatePhase, saveDebate, addTranscriptEntry } = get();
    updatePhase('opening');
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

    set({ debateError: null });
    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Get active AI POVers in fixed order: Prometheus → Sentinel → Cassandra
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    // Collect prior statements as we go (sequential — each sees the ones before it)
    const priorStatements: { speaker: string; statement: string }[] = [];

    for (const poverId of aiPovers) {
      set({ debateGenerating: poverId });

      const info = POVER_INFO[poverId];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx);

      const prompt = buildOpeningStatementPrompt(poverId, topic, taxonomyBlock, priorStatements);

      try {
        const { text } = await generateTextWithProgress(prompt, model, `${info.label} is preparing opening statement (${model})`, set);
        const { statement, taxonomyRefs } = parsePoverResponse(text);

        addTranscriptEntry({
          type: 'opening',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
        });

        priorStatements.push({ speaker: info.label, statement });

        // Save after each statement so progress persists
        await saveDebate();
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to deliver opening statement: ${String(err)}`,
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

    set({ debateError: null });

    // Parse @-mention to determine target
    const { target, cleanedInput } = parseAtMention(input);

    // Validate target is an active POVer
    if (target && !activeDebate.active_povers.includes(target)) {
      const label = target === 'user' ? 'You' : POVER_INFO[target as Exclude<PoverId, 'user'>]?.label || target;
      set({ debateError: `${label} is not in this debate` });
      return;
    }

    // Add user's question to transcript
    addTranscriptEntry({
      type: 'question',
      speaker: 'user',
      content: input,
      taxonomy_refs: [],
      addressing: target || 'all',
    });

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;

    // Determine which AI POVers should respond
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));
    const respondingPovers = target
      ? aiPovers.filter((p) => p === target) // Targeted: only the mentioned POVer
      : aiPovers; // All active AI POVers

    if (respondingPovers.length === 0) {
      // User targeted themselves or no AI POVers — nothing to generate
      await saveDebate();
      return;
    }

    const recentTranscript = formatRecentTranscript(get().activeDebate!.transcript);

    // Generate responses sequentially so each sees prior responses
    for (const poverId of respondingPovers) {
      set({ debateGenerating: poverId });

      const info = POVER_INFO[poverId];
      const ctx = getTaxonomyContext(info.pov);
      const taxonomyBlock = formatTaxonomyContext(ctx);

      // Use the most current transcript (includes responses from prior POVers in this round)
      const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript);

      const prompt = buildDebateResponsePrompt(
        poverId,
        topic,
        taxonomyBlock,
        currentTranscript,
        cleanedInput,
        target ? poverId : 'all',
      );

      try {
        const { text } = await generateTextWithProgress(prompt, model, `${POVER_INFO[poverId].label} is responding (${model})`, set);
        const { statement, taxonomyRefs } = parsePoverResponse(text);

        addTranscriptEntry({
          type: 'statement',
          speaker: poverId,
          content: statement,
          taxonomy_refs: taxonomyRefs,
          addressing: 'user',
        });
      } catch (err) {
        addTranscriptEntry({
          type: 'system',
          speaker: 'system',
          content: `${info.label} failed to respond: ${String(err)}`,
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

    set({ debateError: null });

    const model = getConfiguredModel();
    const topic = activeDebate.topic.final;
    const aiPovers = AI_POVER_ORDER.filter((p) => activeDebate.active_povers.includes(p));

    if (aiPovers.length < 2) {
      set({ debateError: 'Need at least 2 AI debaters for cross-response' });
      return;
    }

    const recentTranscript = formatRecentTranscript(activeDebate.transcript);
    const poverLabels = aiPovers.map((p) => POVER_INFO[p].label);

    // Step 1: Ask the LLM which POVer should respond to whom
    set({ debateGenerating: aiPovers[0] }); // Show some activity

    const selectionPrompt = buildCrossRespondSelectionPrompt(recentTranscript, poverLabels);

    let responderPover: Exclude<PoverId, 'user'> | null = null;
    let focusPoint = '';
    let addressingLabel = 'general';

    try {
      const { text } = await generateTextWithProgress(selectionPrompt, model, `Selecting next responder (${model})`, set);
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
      set({ debateError: `Cross-respond selection failed: ${String(err)}`, debateGenerating: null });
      return;
    }

    if (!responderPover) {
      responderPover = aiPovers[0];
    }

    // Step 2: Generate the cross-response
    set({ debateGenerating: responderPover });

    const info = POVER_INFO[responderPover];
    const ctx = getTaxonomyContext(info.pov);
    const taxonomyBlock = formatTaxonomyContext(ctx);
    const currentTranscript = formatRecentTranscript(get().activeDebate!.transcript);

    const prompt = buildCrossRespondPrompt(
      responderPover,
      topic,
      taxonomyBlock,
      currentTranscript,
      focusPoint,
      addressingLabel,
    );

    try {
      const { text } = await generateTextWithProgress(prompt, model, `${info.label} is cross-responding (${model})`, set);
      const { statement, taxonomyRefs } = parsePoverResponse(text);

      addTranscriptEntry({
        type: 'statement',
        speaker: responderPover,
        content: statement,
        taxonomy_refs: taxonomyRefs,
        addressing: 'all',
        metadata: { cross_respond: true, focus_point: focusPoint, addressing_label: addressingLabel },
      });
    } catch (err) {
      addTranscriptEntry({
        type: 'system',
        speaker: 'system',
        content: `${info.label} failed to cross-respond: ${String(err)}`,
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

    set({ debateError: null, debateGenerating: 'prometheus' });

    const model = getConfiguredModel();
    const fullTranscript = formatRecentTranscript(activeDebate.transcript, 50);
    const prompt = buildDebateSynthesisPrompt(activeDebate.topic.final, fullTranscript);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating synthesis (${model})`, set);

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
          lines.push(`- ${d.point}`);
          if (Array.isArray(d.positions)) {
            for (const pos of d.positions) {
              const label = POVER_INFO[pos.pover as Exclude<PoverId, 'user'>]?.label || pos.pover;
              lines.push(`  - ${label}: ${pos.stance}`);
            }
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
      set({ debateError: `Synthesis failed: ${String(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },

  requestProbingQuestions: async () => {
    const { activeDebate, addTranscriptEntry, saveDebate } = get();
    if (!activeDebate) return;

    set({ debateError: null, debateGenerating: 'prometheus' });

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

    const prompt = buildProbingQuestionsPrompt(activeDebate.topic.final, fullTranscript, unreferenced);

    try {
      const { text } = await generateTextWithProgress(prompt, model, `Generating probing questions (${model})`, set);

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
      set({ debateError: `Probing questions failed: ${String(err)}` });
    } finally {
      set({ debateGenerating: null });
      await saveDebate();
    }
  },
}));
