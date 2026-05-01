// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AI backend service — mirrors main/embeddings.ts without Electron's net.fetch.
 * Uses standard fetch (Node 22+).
 *
 * Provider logic (Gemini, Claude, Groq, OpenAI), retry, and utility functions
 * are delegated to the shared lib/ai-client package.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getApiKey, getProjectRoot, EMBED_SCRIPT, type AIBackend } from './config';
import { ActionableError } from '../../../lib/debate/errors';
import { tavilySearch, buildSearchAugmentedPrompt } from '../../../lib/search/tavily';
import {
  resolveBackend,
  callProvider,
  withRetry,
  withTimeout,
  buildModelIdMap,
  getApiModelId as getApiModelIdFromMap,
  GEMINI_BASE,
  SERVER_RETRY_CONFIG,
  type GenerateOptions,
  type ProviderResult,
  type RateLimitType,
} from '../../../lib/ai-client';

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ── Constants ──

const MAX_RETRIES = 5;
const BATCH_SIZE = 100;

// ── Temperature state ──

let _debateTemperature: number | null = null;

export function setDebateTemperature(temp: number | null): void {
  _debateTemperature = temp;
}

// ── Re-export shared types ──

export type { RateLimitType };

export interface GenerateTextProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
}

// ── Model ID mapping (mtime-cached) ──

let _modelMapCache: Record<string, string> | null = null;
let _modelMapMtime = 0;

function loadModelMap(): Record<string, string> {
  try {
    const configPath = path.join(getProjectRoot(), 'ai-models.json');
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const registry = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[] };
      _modelMapCache = buildModelIdMap(registry as { models: { id: string; apiModelId: string; label: string; backend: string }[]; backends: [] });
      _modelMapMtime = stat.mtimeMs;
      console.log(`[aiBackends] Reloaded model map (${Object.keys(_modelMapCache).length} mappings)`);
    }
  } catch (err) {
    console.warn(`[aiBackends] Failed to load model map:`, err);
    if (!_modelMapCache) _modelMapCache = {};
  }
  return _modelMapCache!;
}

function getApiModelId(friendlyId: string): string {
  const map = loadModelMap();
  const mapped = getApiModelIdFromMap(map, friendlyId);
  if (mapped === friendlyId && /^(openai|claude|groq)-/.test(friendlyId)) {
    console.warn(`[aiBackends] No API model mapping for '${friendlyId}' — sending as-is (this may fail)`);
  }
  return mapped;
}

// ── Token usage tracking ──

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/** Convert shared ProviderResult.usage to the local TokenUsage shape. */
function mapUsage(usage: ProviderResult['usage']): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.promptTokens ?? 0,
    outputTokens: usage.completionTokens ?? 0,
    totalTokens: usage.totalTokens ?? ((usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)),
  };
}

// ── Public API ──

export { resolveBackend };

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (p: GenerateTextProgress) => void,
  timeoutMs?: number,
  explicitApiKey?: string,
): Promise<GenerateResult> {
  const resolved = model || 'gemini-3.1-flash-lite-preview';
  const backend = resolveBackend(resolved);
  const apiKey = explicitApiKey ?? await getApiKey(backend);
  if (!apiKey) {
    const names: Record<AIBackend, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI', tavily: 'Tavily' };
    throw new ActionableError({
      goal: `Generate text via ${names[backend]}`,
      problem: `No ${names[backend]} API key configured`,
      location: 'aiBackends.generateText',
      nextSteps: [`Set your ${names[backend]} API key in Settings`, 'Or switch to a backend that has a key configured'],
    });
  }

  const apiModel = getApiModelId(resolved);
  const opts: GenerateOptions = {
    temperature: _debateTemperature ?? 0.7,
    timeoutMs,
  };

  const result = await withRetry(
    () => callProvider(fetch, backend, prompt, apiModel, apiKey, opts),
    SERVER_RETRY_CONFIG,
    `${backend}/${apiModel}`,
    onRetry
      ? (msg) => {
          // Extract attempt info from the retry log message for the progress callback.
          // Format: "[retry] label attempt N/M failed (reason), waiting Ds..."
          const attemptMatch = msg.match(/attempt (\d+)\/(\d+)/);
          const backoffMatch = msg.match(/waiting (\d+)s/);
          onRetry({
            attempt: attemptMatch ? parseInt(attemptMatch[1], 10) : 1,
            maxRetries: attemptMatch ? parseInt(attemptMatch[2], 10) : SERVER_RETRY_CONFIG.maxRetries,
            backoffSeconds: backoffMatch ? parseInt(backoffMatch[1], 10) : 5,
            limitType: 'unknown',
            limitMessage: msg,
          });
        }
      : undefined,
  );

  return { text: result.text, tokenUsage: mapUsage(result.usage) };
}

export interface GroundingSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
  confidence?: number;
}

export interface GroundingCitation {
  uri: string;
  title: string;
  segments: GroundingSegment[];
}

export async function generateTextWithSearch(
  prompt: string, model?: string,
): Promise<{ text: string; searchQueries?: string[]; citations?: GroundingCitation[] }> {
  const resolved = model || 'gemini-3.1-flash-lite-preview';
  const backend = resolveBackend(resolved);

  if (backend !== 'gemini') {
    const tavilyKey = await getApiKey('tavily');
    if (tavilyKey) {
      const searchQuery = prompt.length > 400 ? prompt.slice(0, 400) : prompt;
      console.log(`[AI] Tavily search for model=${resolved}, query length=${searchQuery.length}`);
      const searchResult = await tavilySearch(searchQuery, tavilyKey, {
        maxResults: 5,
        includeAnswer: true,
        searchDepth: 'basic',
      });
      const { augmentedPrompt, searchQueries, citations: searchCitations } = buildSearchAugmentedPrompt(prompt, searchResult);
      const { text } = await generateText(augmentedPrompt, resolved);
      const citations: GroundingCitation[] = searchCitations.map(c => ({
        uri: c.uri,
        title: c.title,
        segments: [],
      }));
      return {
        text,
        searchQueries: searchQueries.length ? searchQueries : undefined,
        citations: citations.length ? citations : undefined,
      };
    }
    const result = await generateText(prompt, resolved);
    return { text: result.text };
  }

  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new ActionableError({
      goal: 'Perform grounded search via Gemini',
      problem: 'No Gemini API key configured',
      location: 'aiBackends.generateTextWithSearch',
      nextSteps: ['Set your Gemini API key in Settings'],
    });
  }

  const apiModel = getApiModelId(resolved);
  const url = `${GEMINI_BASE}/${apiModel}:generateContent?key=${apiKey}`;

  const response = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
      }),
    }),
    60_000,
    'Gemini grounded search',
  );

  if (!response.ok) {
    const body = await response.text();
    throw new ActionableError({
      goal: 'Perform grounded search via Gemini',
      problem: `API error ${response.status}: ${body.slice(0, 300)}`,
      location: 'aiBackends.generateTextWithSearch',
      nextSteps: ['Check your Gemini API key', 'Verify the model supports grounded search', 'Try again'],
    });
  }

  const json = await response.json() as {
    candidates?: {
      content: { parts: { text: string }[] };
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        groundingSupports?: {
          segment?: { startIndex?: number; endIndex?: number; text?: string };
          groundingChunkIndices?: number[];
          confidenceScores?: number[];
        }[];
      };
    }[];
  };
  if (!json.candidates?.length) {
    throw new ActionableError({
      goal: 'Perform grounded search via Gemini',
      problem: 'No candidates returned from Gemini grounded search',
      location: 'aiBackends.generateTextWithSearch',
      nextSteps: ['Retry the request', 'Check if the query triggers a safety filter', 'Try a different model'],
    });
  }

  let text = json.candidates[0].content.parts
    .filter(p => typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  const meta = json.candidates[0].groundingMetadata;
  const chunks = meta?.groundingChunks ?? [];
  const supports = meta?.groundingSupports ?? [];

  const citations: GroundingCitation[] = chunks.map(c => ({
    uri: c.web?.uri || '',
    title: c.web?.title || c.web?.uri || '(untitled source)',
    segments: [],
  }));
  for (const s of supports) {
    const seg = s.segment;
    if (!seg || typeof seg.startIndex !== 'number' || typeof seg.endIndex !== 'number') continue;
    const idxs = s.groundingChunkIndices ?? [];
    const scores = s.confidenceScores ?? [];
    idxs.forEach((ci, k) => {
      if (ci >= 0 && ci < citations.length) {
        citations[ci].segments.push({
          startIndex: seg.startIndex as number,
          endIndex: seg.endIndex as number,
          text: seg.text,
          confidence: scores[k],
        });
      }
    });
  }

  // If the model returned empty text but grounding supports have segment text,
  // synthesize evidence from the segments so the UI has something to display.
  if (!text && supports.length > 0) {
    const segTexts = supports
      .map(s => s.segment?.text)
      .filter((t): t is string => !!t);
    if (segTexts.length > 0) text = segTexts.join(' ');
  }

  const searchQueries = citations.map(c => c.title).filter(Boolean);

  return {
    text,
    searchQueries: searchQueries.length ? searchQueries : undefined,
    citations: citations.length ? citations : undefined,
  };
}

// ── Embeddings ──

interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, { pov: string; vector: number[] }>;
}

let embeddingsCache: EmbeddingsFile | null = null;

function getEmbeddingsPath(): string {
  const { resolveDataPath } = require('./config');
  return path.join(resolveDataPath('taxonomy/Origin'), 'embeddings.json');
}

function loadEmbeddingsFile(): EmbeddingsFile | null {
  try {
    const p = getEmbeddingsPath();
    if (embeddingsCache) return embeddingsCache;
    embeddingsCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return embeddingsCache;
  } catch {
    return null;
  }
}

async function callGeminiBatchApi(texts: string[], taskType: string, apiKey: string): Promise<number[][]> {
  const GEMINI_MODEL = 'gemini-embedding-001';
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:batchEmbedContents?key=${apiKey}`;
  const requests = texts.map(text => ({
    model: `models/${GEMINI_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
  }));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (response.status === 429 || response.status === 503) {
      if (attempt === MAX_RETRIES) {
        throw new ActionableError({
          goal: 'Compute embeddings via Gemini',
          problem: `Embedding API rate limited after ${MAX_RETRIES} attempts`,
          location: 'aiBackends.callGeminiBatchApi',
          nextSteps: ['Wait a minute and retry', 'Reduce batch size', 'Check Gemini API quota'],
        });
      }
      await new Promise(r => setTimeout(r, Math.min(2 ** attempt, 30) * 1000));
      continue;
    }
    if (!response.ok) {
      throw new ActionableError({
        goal: 'Compute embeddings via Gemini',
        problem: `API error ${response.status}: ${await response.text()}`,
        location: 'aiBackends.callGeminiBatchApi',
        nextSteps: ['Check your Gemini API key', 'Verify the embedding model is available', 'Try again'],
      });
    }

    const json = await response.json() as { embeddings: { values: number[] }[] };
    return json.embeddings.map(e => e.values);
  }
  throw new ActionableError({
    goal: 'Compute embeddings via Gemini',
    problem: `Exhausted ${MAX_RETRIES} retry attempts`,
    location: 'aiBackends.callGeminiBatchApi',
    nextSteps: ['Wait and retry', 'Check Gemini API status'],
  });
}

export async function computeEmbeddings(texts: string[], ids?: string[]): Promise<number[][]> {
  const local = loadEmbeddingsFile();
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const missing: number[] = [];

  if (ids && local) {
    for (let i = 0; i < texts.length; i++) {
      const nid = ids[i];
      if (nid && local.nodes[nid]) results[i] = local.nodes[nid].vector;
      else missing.push(i);
    }
  } else {
    for (let i = 0; i < texts.length; i++) missing.push(i);
  }

  if (missing.length > 0) {
    const apiKey = await getApiKey('gemini');
    if (!apiKey) {
      throw new ActionableError({
        goal: 'Compute embeddings',
        problem: 'No Gemini API key configured for embeddings',
        location: 'aiBackends.computeEmbeddings',
        nextSteps: ['Set your Gemini API key in Settings'],
      });
    }
    const missingTexts = missing.map(i => texts[i]);
    const all: number[][] = [];
    for (let i = 0; i < missingTexts.length; i += BATCH_SIZE) {
      const batch = missingTexts.slice(i, i + BATCH_SIZE);
      all.push(...await callGeminiBatchApi(batch, 'RETRIEVAL_DOCUMENT', apiKey));
    }
    for (let j = 0; j < missing.length; j++) results[missing[j]] = all[j];
  }

  return results as number[][];
}

function computeQueryViaLocalPython(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [EMBED_SCRIPT, 'encode', text], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`Python embed failed: ${err.message}\n${stderr}`)); return; }
      try {
        const v = JSON.parse(stdout) as number[];
        if (!Array.isArray(v) || v.length === 0) { reject(new Error('Empty vector')); return; }
        resolve(v);
      } catch (e) { reject(new Error(`Parse failed: ${e}`)); }
    });
  });
}

export async function computeQueryEmbedding(text: string): Promise<number[]> {
  try {
    return await computeQueryViaLocalPython(text);
  } catch {
    const apiKey = await getApiKey('gemini');
    if (!apiKey) {
      throw new ActionableError({
        goal: 'Compute query embedding',
        problem: 'No Gemini API key and local Python embedding unavailable',
        location: 'aiBackends.computeQueryEmbedding',
        nextSteps: [
          'Set your Gemini API key in Settings',
          'Or install Python with sentence-transformers: pip install sentence-transformers',
        ],
      });
    }
    const vectors = await callGeminiBatchApi([text], 'RETRIEVAL_QUERY', apiKey);
    return vectors[0];
  }
}

export async function updateNodeEmbeddings(nodes: { id: string; text: string; pov: string }[]): Promise<void> {
  if (nodes.length === 0) return;
  const filePath = getEmbeddingsPath();
  const items = nodes.map(n => ({ id: n.id, text: n.text }));

  const vectors = await new Promise<Record<string, number[]>>((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'batch-encode'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`batch-encode failed: ${err.message}\n${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`Parse failed: ${e}`)); }
    });
    child.stdin!.write(JSON.stringify(items));
    child.stdin!.end();
  });

  let data: EmbeddingsFile;
  try { data = JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { data = { model: 'all-MiniLM-L6-v2', dimension: 384, node_count: 0, nodes: {} }; }

  for (const node of nodes) {
    if (vectors[node.id]) data.nodes[node.id] = { pov: node.pov, vector: vectors[node.id] };
  }
  data.node_count = Object.keys(data.nodes).length;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  embeddingsCache = null;
}

// ── NLI classification ──

export async function classifyNli(pairs: { text_a: string; text_b: string }[]): Promise<unknown[]> {
  if (pairs.length === 0) return [];
  return new Promise((resolve, reject) => {
    const child = execFile(PYTHON, [EMBED_SCRIPT, 'nli-classify'], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`NLI failed: ${err.message}\n${stderr}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`Parse failed: ${e}`)); }
    });
    child.stdin!.write(JSON.stringify(pairs));
    child.stdin!.end();
  });
}

// ── Model discovery (refresh) ──

export async function refreshAIModels(): Promise<unknown> {
  const result: Record<string, { ok: boolean; count: number; error?: string }> = {};
  for (const backend of ['gemini', 'claude', 'groq'] as AIBackend[]) {
    const key = await getApiKey(backend);
    if (!key) { result[backend] = { ok: false, count: 0, error: 'No API key' }; continue; }
    try {
      if (backend === 'gemini') {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!resp.ok) {
          throw new ActionableError({
            goal: 'Refresh AI model list',
            problem: `Gemini model discovery failed with HTTP ${resp.status}`,
            location: 'aiBackends.refreshAIModels',
            nextSteps: ['Check your Gemini API key', 'Try again later'],
          });
        }
        const json = await resp.json() as { models: unknown[] };
        result[backend] = { ok: true, count: json.models?.length || 0 };
      } else {
        result[backend] = { ok: true, count: 0, error: 'Discovery not implemented for this backend in container mode' };
      }
    } catch (err) {
      result[backend] = { ok: false, count: 0, error: String(err) };
    }
  }
  return result;
}
