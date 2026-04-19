// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * AI backend service — mirrors main/embeddings.ts without Electron's net.fetch.
 * Uses standard fetch (Node 22+).
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getApiKey, getProjectRoot, EMBED_SCRIPT, type AIBackend } from './config';
import { tavilySearch, buildSearchAugmentedPrompt } from '../../../lib/search/tavily';

const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ── Constants ──

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 5;
const BATCH_SIZE = 100;

// ── Temperature state ──

let _debateTemperature: number | null = null;

export function setDebateTemperature(temp: number | null): void {
  _debateTemperature = temp;
}

// ── Rate limit parsing ──

export type RateLimitType = 'RPM' | 'TPM' | 'RPD' | 'unknown';

export interface GenerateTextProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
}

function parseRateLimitType(bodyText: string): { limitType: RateLimitType; limitMessage: string } {
  try {
    const json = JSON.parse(bodyText);
    const msg: string = json?.error?.message ?? '';
    const lower = msg.toLowerCase();
    if (lower.includes('per minute') || lower.includes('rpm'))
      return { limitType: 'RPM', limitMessage: 'Requests per minute quota exceeded. Retry should succeed in under a minute.' };
    if (lower.includes('tokens per minute') || lower.includes('tpm'))
      return { limitType: 'TPM', limitMessage: 'Tokens per minute quota exceeded. Retry should succeed in under a minute.' };
    if (lower.includes('per day') || lower.includes('rpd'))
      return { limitType: 'RPD', limitMessage: 'Daily request quota exceeded. Try a lighter model, or wait until quota resets (usually midnight PT).' };
    if (msg) return { limitType: 'unknown', limitMessage: msg };
  } catch { /* not JSON */ }
  return { limitType: 'unknown', limitMessage: 'Rate limited by API. Retrying with exponential backoff.' };
}

// ── Backend resolution ──

function resolveBackend(model: string): AIBackend {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  return 'gemini';
}

// ── Model ID mapping ──

let _modelMapCache: Record<string, string> | null = null;
let _modelMapMtime = 0;

function getApiModelId(friendlyId: string): string {
  try {
    const configPath = path.join(getProjectRoot(), 'ai-models.json');
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[] };
      _modelMapCache = {};
      for (const m of config.models) {
        if (m.apiModelId && m.apiModelId !== m.id) {
          _modelMapCache[m.id] = m.apiModelId;
        }
      }
      _modelMapMtime = stat.mtimeMs;
    }
  } catch {
    if (!_modelMapCache) _modelMapCache = {};
  }
  return _modelMapCache![friendlyId] || friendlyId;
}

// ── Timeout helper ──

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

// ── Backend-specific generation ──

async function generateViaGemini(
  prompt: string, model: string, apiKey: string,
  onRetry?: (p: GenerateTextProgress) => void, timeoutMs?: number,
): Promise<string> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: _debateTemperature ?? 0.7, maxOutputTokens: 16384 },
          }),
        }),
        timeoutMs ?? 60_000,
        'Gemini API request',
      );
    } catch (err: unknown) {
      if (attempt === MAX_RETRIES) throw err instanceof Error ? err : new Error(String(err));
      const backoff = Math.min(2 ** attempt, 30);
      onRetry?.({ attempt, maxRetries: MAX_RETRIES, backoffSeconds: backoff, limitType: 'unknown', limitMessage: 'Network error. Retrying...' });
      await new Promise(r => setTimeout(r, backoff * 1000));
      continue;
    }

    if (response.status === 429 || response.status === 503) {
      let retryBody = '';
      try { retryBody = await response.text(); } catch { /* ignore */ }
      if (response.status === 429) {
        const { limitType, limitMessage } = parseRateLimitType(retryBody);
        if (attempt === MAX_RETRIES) throw new Error(`Gemini API rate limited (${limitType}) after ${MAX_RETRIES} attempts. ${limitMessage}`);
        const backoff = limitType === 'RPD' ? Math.min(2 ** (attempt + 2), 60) : Math.min(2 ** attempt, 30);
        onRetry?.({ attempt, maxRetries: MAX_RETRIES, backoffSeconds: backoff, limitType, limitMessage });
        await new Promise(r => setTimeout(r, backoff * 1000));
        continue;
      }
      if (attempt === MAX_RETRIES) throw new Error(`Gemini model unavailable (503) after ${MAX_RETRIES} attempts.`);
      const backoff = Math.min(2 ** attempt, 30);
      onRetry?.({ attempt, maxRetries: MAX_RETRIES, backoffSeconds: backoff, limitType: 'unknown', limitMessage: 'Model experiencing high demand.' });
      await new Promise(r => setTimeout(r, backoff * 1000));
      continue;
    }

    const bodyText = await withTimeout(response.text(), timeoutMs ? Math.max(timeoutMs / 2, 30_000) : 30_000, 'Reading response');
    if (!response.ok) throw new Error(`Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`);

    const json = JSON.parse(bodyText) as { candidates?: { content: { parts: { text: string }[] } }[] };
    if (!json.candidates?.length) throw new Error(`No candidates from Gemini. Body: ${bodyText.slice(0, 200)}`);
    return json.candidates[0].content.parts.map(p => p.text).join('');
  }
  throw new Error('generateText: exhausted retries');
}

async function generateViaClaude(
  prompt: string, model: string, apiKey: string, timeoutMs?: number,
): Promise<string> {
  const apiModel = getApiModelId(model);
  const response = await withTimeout(
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: 8192,
        temperature: _debateTemperature ?? 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    }),
    timeoutMs ?? 120_000,
    'Claude API request',
  );

  const bodyText = await withTimeout(response.text(), 30_000, 'Reading Claude response');
  if (!response.ok) throw new Error(`Claude API error ${response.status}: ${bodyText.slice(0, 500)}`);

  const json = JSON.parse(bodyText) as { content?: { type: string; text: string }[] };
  if (!json.content?.length) throw new Error(`No content in Claude response: ${bodyText.slice(0, 200)}`);
  return json.content.filter(c => c.type === 'text').map(c => c.text).join('');
}

async function generateViaGroq(
  prompt: string, model: string, apiKey: string, timeoutMs?: number,
): Promise<string> {
  const apiModel = getApiModelId(model);
  const response = await withTimeout(
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: _debateTemperature ?? 0.7,
        max_tokens: 8192,
      }),
    }),
    timeoutMs ?? 60_000,
    'Groq API request',
  );

  const bodyText = await withTimeout(response.text(), 30_000, 'Reading Groq response');
  if (!response.ok) throw new Error(`Groq API error ${response.status}: ${bodyText.slice(0, 500)}`);

  const json = JSON.parse(bodyText) as { choices?: { message: { content: string } }[] };
  if (!json.choices?.length) throw new Error(`No choices in Groq response: ${bodyText.slice(0, 200)}`);
  return json.choices[0].message.content;
}

// ── Public API ──

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (p: GenerateTextProgress) => void,
  timeoutMs?: number,
): Promise<string> {
  const resolved = model || 'gemini-3.1-flash-lite-preview';
  const backend = resolveBackend(resolved);
  const apiKey = await getApiKey(backend);
  if (!apiKey) {
    const names: Record<AIBackend, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', tavily: 'Tavily' };
    throw new Error(`No ${names[backend]} API key configured. Set it in Settings.`);
  }

  switch (backend) {
    case 'claude': return generateViaClaude(prompt, resolved, apiKey, timeoutMs);
    case 'groq': return generateViaGroq(prompt, resolved, apiKey, timeoutMs);
    default: return generateViaGemini(prompt, resolved, apiKey, onRetry, timeoutMs);
  }
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
      const text = await generateText(augmentedPrompt, resolved);
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
    const text = await generateText(prompt, resolved);
    return { text };
  }

  const apiKey = await getApiKey('gemini');
  if (!apiKey) throw new Error('No Gemini API key configured.');

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
    throw new Error(`Gemini search error ${response.status}: ${body.slice(0, 300)}`);
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
  if (!json.candidates?.length) throw new Error('No candidates from Gemini grounded search');

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
      if (attempt === MAX_RETRIES) throw new Error(`Gemini Embedding API rate limited after ${MAX_RETRIES} attempts.`);
      await new Promise(r => setTimeout(r, Math.min(2 ** attempt, 30) * 1000));
      continue;
    }
    if (!response.ok) throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);

    const json = await response.json() as { embeddings: { values: number[] }[] };
    return json.embeddings.map(e => e.values);
  }
  throw new Error('callGeminiBatchApi: exhausted retries');
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
    if (!apiKey) throw new Error('No Gemini API key for embeddings.');
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
    if (!apiKey) throw new Error('No Gemini API key and Python unavailable for embeddings.');
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
  // Simplified version — delegates to the same ai-models.json update logic
  // For the container, models are pre-configured. This just validates keys work.
  const result: Record<string, { ok: boolean; count: number; error?: string }> = {};
  for (const backend of ['gemini', 'claude', 'groq'] as AIBackend[]) {
    const key = await getApiKey(backend);
    if (!key) { result[backend] = { ok: false, count: 0, error: 'No API key' }; continue; }
    try {
      if (backend === 'gemini') {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
