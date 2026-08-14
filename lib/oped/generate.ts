// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AIAdapter } from '../debate/aiAdapter.js';
import type { PovKey } from '../debate/types.js';
import { stripCodeFences } from '../debate/helpers.js';
import type { ScoredPovNode, ScoredSituationNode } from '../debate/taxonomyRelevance.js';
import { scoreNodeRelevance, selectRelevantNodes, selectRelevantSituationNodes } from '../debate/taxonomyRelevance.js';
import { loadTaxonomy } from '../debate/taxonomyLoader.js';
import { computeEmbedding } from '../embeddings/onnxEmbedding.js';
import type { OpEdMember, OpEdParams, OpEdSet, OpEdGroundingRef } from './types.js';
import { resolveOutletBand } from './outletBands.js';
import { loadAndAssemblePrompt, assembleReflectionPrompt, type SourceBrief } from './promptLoader.js';

// ── Public request / deps types ───────────────────────────────────────────────

export interface GenerateOpEdRequest {
  set_id: string;
  topic: string;
  params: OpEdParams;
  povs: PovKey[];
  /** P2 slot: pre-fetched source brief text (FromUrl). Omit for P1 FromTopic. */
  sourceBrief?: string;
  signal?: AbortSignal;
}

export interface OpEdGeneratorDeps {
  adapter: AIAdapter;
  /** Absolute path to dir containing op-ed-*.prompt files (shared PS+TS artifacts). */
  promptsDir: string;
  /** Repo root — locates soul-docs/ and taxonomy/embeddings data. */
  repoRoot: string;
}

// ── Progress event union ──────────────────────────────────────────────────────

export type OpEdProgressEvent =
  | { type: 'grounding_done'; nodeCount: number }
  | { type: 'grounding_failed'; error: string }
  | { type: 'voice_start'; pov: PovKey }
  | { type: 'voice_complete'; pov: PovKey; member: OpEdMember }
  | { type: 'voice_failed'; pov: PovKey; error: string }
  | { type: 'voice_cancelled'; pov: PovKey }
  | { type: 'complete'; set: OpEdSet };

// ── Soul doc (internal) ───────────────────────────────────────────────────────

interface SoulVoice {
  disposition: string;
  style: string;
  reasoning: string;
  evidence: string;
  signature: string;
  prose_style: string;
  voice_hygiene: string;
}

interface SoulDoc {
  label: string;
  personality: string;
  voice: SoulVoice;
  value_hierarchy: string[];
  epistemic_stance: string[];
  anti_patterns: string[];
}

// ── Soul doc helpers ──────────────────────────────────────────────────────────

function loadSoulDoc(repoRoot: string, pov: PovKey): SoulDoc {
  const soulPath = join(repoRoot, 'lib', 'debate', 'soul-docs', `${pov}.soul.json`);
  return JSON.parse(readFileSync(soulPath, 'utf-8')) as SoulDoc;
}

function buildVoiceBlock(soul: SoulDoc): string {
  const lines: string[] = [
    `PERSONALITY: ${soul.personality}`,
    `DISPOSITION: ${soul.voice.disposition}`,
    `RHETORICAL STYLE: ${soul.voice.style}`,
    `REASONING MODE: ${soul.voice.reasoning}`,
    `PREFERRED EVIDENCE: ${soul.voice.evidence}`,
    `SIGNATURE MOVE: ${soul.voice.signature}`,
    '',
    soul.voice.prose_style,
    '',
    soul.voice.voice_hygiene,
    '',
    'VALUE HIERARCHY (in priority order):',
    ...soul.value_hierarchy.map((v, i) => `  ${i + 1}. ${v}`),
    '',
    'EPISTEMIC STANCE:',
    ...soul.epistemic_stance.map(e => `  - ${e}`),
    '',
    'ANTI-PATTERNS (never do these):',
    ...soul.anti_patterns.map(a => `  - ${a}`),
  ];
  return lines.join('\n');
}

// ── Grounding text formatting ─────────────────────────────────────────────────

const VOICE_ONLY_GROUNDING = '(none — argue from your camp voice and general knowledge)';
const VOICE_ONLY_SITUATIONS = '(none supplied)';

function formatGroundingNodes(nodes: ScoredPovNode[]): string {
  if (nodes.length === 0) return VOICE_ONLY_GROUNDING;
  return nodes
    .map(({ node, score: _score }) => {
      const desc = node.description.length > 240 ? node.description.slice(0, 240) + '…' : node.description;
      return `- [${node.id}] [${node.category}] ${node.label}: ${desc}`;
    })
    .join('\n');
}

function formatSituationNodes(nodes: ScoredSituationNode[]): string {
  if (nodes.length === 0) return VOICE_ONLY_SITUATIONS;
  return nodes
    .map(({ node, score: _score }) => {
      const desc = node.description.length > 300 ? node.description.slice(0, 300) + '…' : node.description;
      return `- [${node.id}] ${node.label}: ${desc}`;
    })
    .join('\n');
}

function buildGroundingList(nodes: ScoredPovNode[], sitNodes: ScoredSituationNode[]): string {
  const bdiLines = nodes.map(
    ({ node }) => `- [${node.id}] (bdi/${node.category}) ${node.label}`,
  );
  const sitLines = sitNodes.map(
    ({ node }) => `- [${node.id}] (situation/Situation) ${node.label}`,
  );
  return [...bdiLines, ...sitLines].join('\n');
}

// ── Essay response schema ─────────────────────────────────────────────────────

const ESSAY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    subtitle: { type: 'string' },
    body_markdown: { type: 'string' },
    word_count: { type: 'integer' },
    pitch_email: { type: 'string' },
    stance: { type: 'string', description: 'How the camp engages the source: agree/extend/rebut (or empty if no source)' },
  },
  required: ['headline', 'body_markdown', 'word_count'],
} as const;

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: {
    grounding_usage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reflection: { type: 'string' },
        },
        required: ['id', 'reflection'],
      },
    },
  },
  required: ['grounding_usage'],
} as const;

// ── Per-voice generation ──────────────────────────────────────────────────────

interface EssayResponse {
  headline: string;
  subtitle?: string;
  body_markdown: string;
  word_count?: number;
  pitch_email?: string;
  stance?: string;
}

interface ReflectionResponse {
  grounding_usage: { id: string; reflection: string }[];
}

async function runVoiceGeneration(
  pov: PovKey,
  groundingNodes: ScoredPovNode[],
  sitNodes: ScoredSituationNode[],
  request: GenerateOpEdRequest,
  deps: OpEdGeneratorDeps,
): Promise<OpEdMember> {
  const soul = loadSoulDoc(deps.repoRoot, pov);
  const band = resolveOutletBand(request.params.outlet);
  const targetWords = request.params.wordCount > 0 ? request.params.wordCount : band.words;
  const maxTokens = Math.ceil(targetWords * 3) + 5000;

  const { system, user } = loadAndAssemblePrompt(deps.promptsDir, {
    topic: request.topic,
    params: request.params,
    pov,
    povLabel: soul.label,
    voiceBlock: buildVoiceBlock(soul),
    groundingNodes: formatGroundingNodes(groundingNodes),
    situations: formatSituationNodes(sitNodes),
    sourceMaterial: request.sourceBrief ?? '(no external source supplied — argue from the topic and general knowledge)',
    outletGuidance: band.guidance,
    targetWords,
  });

  // Prepend system to prompt — generateText has no separate system channel;
  // adapters that support adapter.generate() can be wired later for native system messages.
  const fullPrompt = `${system}\n\n---\n\n${user}`;
  const rawText = await deps.adapter.generateText(fullPrompt, request.params.model, {
    maxTokens,
    temperature: 0.8,
    responseSchema: ESSAY_SCHEMA as Record<string, unknown>,
    signal: request.signal,
  });

  let parsed: EssayResponse;
  try {
    parsed = JSON.parse(stripCodeFences(rawText)) as EssayResponse;
  } catch {
    parsed = { headline: '', body_markdown: rawText, word_count: undefined };
  }

  const body = parsed.body_markdown ?? '';
  const actualWordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  // Build initial grounding refs (reflection populated below if grounding was used)
  const allGroundingRefs: OpEdGroundingRef[] = [
    ...groundingNodes.map(({ node, score }) => ({
      node_id: node.id,
      label: node.label,
      category: String(node.category),
      pov,
      relevance: score.toFixed(4),
      how_reflected: '(not reported)',
    })),
    ...sitNodes.map(({ node, score }) => ({
      node_id: node.id,
      label: node.label,
      category: 'Situation',
      pov,
      relevance: score.toFixed(4),
      how_reflected: '(not reported)',
    })),
  ];

  // Reflection pass — best-effort, maps grounding elements to where they appear
  if (allGroundingRefs.length > 0 && body) {
    try {
      const groundingList = buildGroundingList(groundingNodes, sitNodes);
      const reflPrompt = assembleReflectionPrompt(deps.promptsDir, body, groundingList);
      const reflMaxTokens = Math.max(4000, allGroundingRefs.length * 150 + 3000);
      const reflRaw = await deps.adapter.generateText(reflPrompt, request.params.model, {
        maxTokens: reflMaxTokens,
        temperature: 0.2,
        responseSchema: REFLECTION_SCHEMA as Record<string, unknown>,
        signal: request.signal,
      });
      const reflParsed = JSON.parse(stripCodeFences(reflRaw)) as ReflectionResponse;
      const usageMap = new Map(reflParsed.grounding_usage.map(u => [u.id, u.reflection]));
      for (const ref of allGroundingRefs) {
        const refl = usageMap.get(ref.node_id);
        if (refl) ref.how_reflected = refl;
      }
    } catch {
      // Reflection failure is non-fatal — how_reflected stays '(not reported)'
    }
  }

  return {
    pov,
    status: 'complete',
    headline: parsed.headline ?? '',
    subtitle: parsed.subtitle ?? '',
    body,
    pitch: parsed.pitch_email || undefined,
    wordCount: actualWordCount,
    grounding: allGroundingRefs,
  };
}

// ── Main exported generator ───────────────────────────────────────────────────

/**
 * Generate a multi-voice op-ed set, yielding progress events.
 * Voices run in parallel (Promise.all fan-out). Grounding failure degrades to
 * voice-only rather than throwing. Signal is threaded into every AI call.
 * Always yields `{ type: 'complete', set }` last — set.opeds carries all
 * members including failed/cancelled (partial-set contract, e/91#2 cond. 1).
 */
export async function* generateOpEdSet(
  request: GenerateOpEdRequest,
  deps: OpEdGeneratorDeps,
): AsyncGenerator<OpEdProgressEvent> {
  // ── Step 1: grounding ─────────────────────────────────────────────────────
  // BDI grounding is selected PER POV — the taxonomy is camp-partitioned
  // (`taxonomy[pov].nodes`, ids `{pov}-{category}-{NNN}`), so a camp's grounding IS
  // its own belief/desire/intention nodes. Selecting once from `povs[0]` grounded
  // every voice in the first camp's nodes, making all voices display identical
  // grounding tables (a Safetyist essay grounded in `acc-*` nodes). Situations are
  // camp-agnostic, so `sitNodes` is legitimately selected once and shared.
  const groundingByPov = new Map<PovKey, ScoredPovNode[]>();
  let sitNodes: ScoredSituationNode[] = [];

  try {
    const taxonomy = loadTaxonomy(deps.repoRoot);
    const queryParts = [request.topic, request.params.newsHook, request.params.thesis].filter(Boolean);
    const query = queryParts.join('. ');
    const vec = await computeEmbedding(query);
    const scores = scoreNodeRelevance(vec, taxonomy.embeddings);

    for (const pov of request.povs) {
      groundingByPov.set(pov, selectRelevantNodes(
        taxonomy[pov]?.nodes ?? [],
        scores,
        undefined, // use default threshold
        2,         // minPerCategory
        12,        // maxTotal — mirrors PS MaxGroundingNodes default
      ));
    }
    sitNodes = selectRelevantSituationNodes(
      taxonomy.situations?.nodes ?? [],
      scores,
      undefined,
      1,
      3,
    );
    // Count distinct grounding elements across the whole set (per-POV BDI node ids
    // are disjoint by camp; situations counted once) — a truthful set-level total.
    const distinctBdi = new Set<string>();
    for (const nodes of groundingByPov.values()) {
      for (const { node } of nodes) distinctBdi.add(node.id);
    }
    yield { type: 'grounding_done', nodeCount: distinctBdi.size + sitNodes.length };
  } catch (err) {
    yield { type: 'grounding_failed', error: String(err) };
    // continue voice-only
  }

  // ── Step 2: parallel voice fan-out ────────────────────────────────────────
  const queue: OpEdProgressEvent[] = [];
  let wakeResolve: (() => void) | null = null;
  let remaining = request.povs.length;
  const members: { pov: PovKey; member: OpEdMember }[] = [];

  function enqueue(ev: OpEdProgressEvent): void {
    queue.push(ev);
    const r = wakeResolve;
    wakeResolve = null;
    r?.();
  }

  async function runVoice(pov: PovKey): Promise<void> {
    if (request.signal?.aborted) {
      members.push({ pov, member: { pov, status: 'cancelled', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] } });
      enqueue({ type: 'voice_cancelled', pov });
    } else {
      enqueue({ type: 'voice_start', pov });
      try {
        const member = await runVoiceGeneration(pov, groundingByPov.get(pov) ?? [], sitNodes, request, deps);
        members.push({ pov, member });
        enqueue({ type: 'voice_complete', pov, member });
      } catch (err) {
        const cancelled = request.signal?.aborted;
        members.push({ pov, member: { pov, status: cancelled ? 'cancelled' : 'failed', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] } });
        if (cancelled) {
          enqueue({ type: 'voice_cancelled', pov });
        } else {
          enqueue({ type: 'voice_failed', pov, error: String(err) });
        }
      }
    }
    remaining--;
    const r = wakeResolve;
    wakeResolve = null;
    r?.();
  }

  void Promise.all(request.povs.map(pov => runVoice(pov)));

  while (remaining > 0 || queue.length > 0) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }
    if (remaining > 0 && queue.length === 0) {
      await new Promise<void>(r => { wakeResolve = r; });
    }
  }

  // ── Step 3: assemble set (preserve request.povs order) ───────────────────
  const memberMap = new Map(members.map(({ pov, member }) => [pov, member]));
  const orderedMembers = request.povs.map(pov => memberMap.get(pov)!).filter(Boolean);

  const set: OpEdSet = {
    schema_version: 1,
    set_id: request.set_id,
    topic: request.topic,
    params: request.params,
    created_at: new Date().toISOString(),
    opeds: orderedMembers,
  };

  yield { type: 'complete', set };
}
