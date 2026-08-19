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
import { loadAndAssemblePrompt, assembleReflectionPrompt, assembleSourceBriefPrompt, type SourceBrief } from './promptLoader.js';
import { FABRICATED_LEDE_GUARD } from './opedGuards.js';

// ── Public request / deps types ───────────────────────────────────────────────

export interface GenerateOpEdRequest {
  set_id: string;
  topic: string;
  params: OpEdParams;
  povs: PovKey[];
  /** Raw source markdown (pre-fetched from URL). Omit for topic-only requests. */
  sourceMaterial?: string;
  signal?: AbortSignal;
}

export interface OpEdGeneratorDeps {
  adapter: AIAdapter;
  /** Absolute path to dir containing op-ed-*.prompt files (shared PS+TS artifacts). */
  promptsDir: string;
  /** Repo root — locates soul-docs/ and taxonomy/embeddings data. */
  repoRoot: string;
  /** Optional recorder for guard warnings — pass getGlobalRecorder() from the host. */
  recorder?: { record: (event: Record<string, unknown>) => void } | null;
}

// ── Progress event union ──────────────────────────────────────────────────────

export type OpEdProgressEvent =
  | { type: 'source_brief_done' }
  | { type: 'source_brief_failed'; error: string }
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

const SOURCE_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    thesis: { type: 'string' },
    author: { type: 'string' },
    actor_type: { type: 'string' },
    stance: { type: 'string' },
    primary_recommendations: { type: 'array', items: { type: 'string' } },
    key_claims: { type: 'array', items: { type: 'string' } },
    readable: { type: 'boolean' },
  },
  required: ['thesis', 'author', 'actor_type', 'stance', 'primary_recommendations', 'key_claims', 'readable'],
} as const;

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
          document_claims: { type: 'array', items: { type: 'string' } },
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
  grounding_usage: { id: string; reflection: string; document_claims?: string[] }[];
}

async function runVoiceGeneration(
  pov: PovKey,
  groundingNodes: ScoredPovNode[],
  sitNodes: ScoredSituationNode[],
  request: GenerateOpEdRequest,
  deps: OpEdGeneratorDeps,
  sourceBrief: SourceBrief | undefined,
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
    sourceMaterial: request.sourceMaterial ?? '(no external source supplied — argue from the topic and general knowledge)',
    sourceBrief,
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
      const sourceClaims = sourceBrief?.key_claims?.length
        ? sourceBrief.key_claims.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
        : '(none)';
      const reflPrompt = assembleReflectionPrompt(deps.promptsDir, body, groundingList, sourceClaims);
      const reflMaxTokens = Math.max(4000, allGroundingRefs.length * 150 + 3000);
      const reflRaw = await deps.adapter.generateText(reflPrompt, request.params.model, {
        maxTokens: reflMaxTokens,
        temperature: 0.2,
        responseSchema: REFLECTION_SCHEMA as Record<string, unknown>,
        signal: request.signal,
      });
      const reflParsed = JSON.parse(stripCodeFences(reflRaw)) as ReflectionResponse;
      const usageMap = new Map(reflParsed.grounding_usage.map(u => [u.id, u]));
      for (const ref of allGroundingRefs) {
        const usage = usageMap.get(ref.node_id);
        if (usage) {
          ref.how_reflected = usage.reflection;
          if (usage.document_claims?.length) ref.document_claims = usage.document_claims;
        }
      }
    } catch {
      // Reflection failure is non-fatal — how_reflected stays '(not reported)'
    }
  }

  // Guard scan: when newsHook was empty, check the lede (first 500 chars) for
  // fabricated dated-event markers. Flag without mutating the body (t/2730).
  const emptyHook = !request.params.newsHook?.trim();
  const fabricatedLede = emptyHook && FABRICATED_LEDE_GUARD.test(body.slice(0, 500));
  if (fabricatedLede) {
    deps.recorder?.record({
      type: 'system.warning', component: 'opedGenerate', level: 'warn',
      message: `FABRICATED_LEDE_GUARD matched for pov=${pov} set=${request.set_id} — empty-hook lede may contain invented dated event`,
    });
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
    ...(fabricatedLede && { fabricated_lede: true as const }),
  };
}

// ── Main exported generator ───────────────────────────────────────────────────

/**
 * Generate a multi-voice op-ed set, yielding progress events.
 * Voices run SEQUENTIALLY (one at a time) to bound peak memory (t/2719) — grounding
 * failure degrades to voice-only rather than throwing. Signal is threaded into every AI call.
 * Always yields `{ type: 'complete', set }` last — set.opeds carries all
 * members including failed/cancelled (partial-set contract, e/91#2 cond. 1).
 */
export async function* generateOpEdSet(
  request: GenerateOpEdRequest,
  deps: OpEdGeneratorDeps,
): AsyncGenerator<OpEdProgressEvent> {
  // ── Step 0: source-brief comprehension (when URL source present) ─────────
  // Extracts structured SourceBrief (thesis/author/stance/key_claims) from raw
  // markdown so {{SOURCE_AUTHOR/THESIS/STANCE/RECOMMENDATIONS/KEY_CLAIMS}} are
  // populated in the generation prompt. Non-fatal — falls through with undefined
  // so voices still generate from raw {{SOURCE_MATERIAL}} text on failure.
  let sourceBrief: SourceBrief | undefined;
  if (request.sourceMaterial) {
    try {
      const briefPrompt = assembleSourceBriefPrompt(deps.promptsDir, request.sourceMaterial);
      const briefRaw = await deps.adapter.generateText(briefPrompt, request.params.model, {
        maxTokens: 2000,
        temperature: 0.1,
        responseSchema: SOURCE_BRIEF_SCHEMA as Record<string, unknown>,
        signal: request.signal,
      });
      const parsed = JSON.parse(stripCodeFences(briefRaw)) as SourceBrief;
      if (parsed.readable !== false) {
        sourceBrief = parsed;
      } else {
        // t/2807: Step-0 judged the supplied source unreadable — voices then generate
        // from topic only, silently ignoring the source the caller provided. Record it
        // so "source supplied but not represented" is diagnosable (via the host recorder).
        deps.recorder?.record({
          type: 'system.error', component: 'oped-generate', level: 'warn',
          message: 'Op-ed source brief marked unreadable — generating from topic only despite a supplied source',
        });
      }
      yield { type: 'source_brief_done' };
    } catch (err) {
      yield { type: 'source_brief_failed', error: String(err) };
    }
  }

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

  // ── Step 2: sequential voice generation (memory-bounded, t/2719) ──────────
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
        const member = await runVoiceGeneration(pov, groundingByPov.get(pov) ?? [], sitNodes, request, deps, sourceBrief);
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

  // t/2719: run voices SEQUENTIALLY (concurrency 1), not Promise.all. Parallel fan-out
  // kept every voice's AI response + JSON.parse resident at once which, on top of the
  // in-process ONNX model + embeddings + taxonomy, OOM-crashed the Node process mid-stream
  // (a single create took the whole server down). Sequential caps peak at one voice; the
  // queue/drain loop below still streams per-voice progress in order.
  void (async () => { for (const pov of request.povs) await runVoice(pov); })();

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
