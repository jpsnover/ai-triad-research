// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { loadApiKey } from './apiKeyStore';
import { net } from 'electron';
import { PROJECT_ROOT } from './fileIO';

/** Find embed_taxonomy.py — may be in PROJECT_ROOT/scripts or one level up (when PROJECT_ROOT is taxonomy-editor/) */
function findEmbedScript(): string {
  const candidates = [
    path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py'),
    path.join(PROJECT_ROOT, '..', 'scripts', 'embed_taxonomy.py'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return candidates[0]; // fallback — will produce a clear "file not found" error
}
const EMBED_SCRIPT = findEmbedScript();
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

// ---------- Warm-up: preload sentence_transformers model ----------

let _warmupDone = false;

/**
 * Fire-and-forget: spawns a trivial encode so Python loads the model into memory.
 * Subsequent computeQueryViaLocalPython calls will start much faster because
 * the OS has the model files and libraries in its disk cache.
 */
export function warmupEmbeddingModel(): void {
  if (_warmupDone) return;
  _warmupDone = true;
  console.log('[embeddings] Warming up local embedding model...');
  const t0 = Date.now();
  execFile(
    PYTHON,
    [EMBED_SCRIPT, 'encode', 'warmup'],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
    (err, _stdout, _stderr) => {
      if (err) {
        console.warn('[embeddings] Warmup failed (non-fatal):', err.message);
      } else {
        console.log(`[embeddings] Warmup complete in ${Date.now() - t0}ms`);
      }
    },
  );
}

// ---------- Local embeddings from embeddings.json ----------

interface EmbeddingsFile {
  model: string;
  dimension: number;
  node_count: number;
  nodes: Record<string, { pov: string; vector: number[] }>;
}

let embeddingsCache: EmbeddingsFile | null = null;
let embeddingsCachePath: string | null = null;

function getEmbeddingsPath(): string {
  const { resolveDataPath } = require('./fileIO');
  return path.join(resolveDataPath('taxonomy/Origin'), 'embeddings.json');
}

function loadEmbeddingsFile(): EmbeddingsFile | null {
  const filePath = getEmbeddingsPath();
  if (embeddingsCache && embeddingsCachePath === filePath) {
    return embeddingsCache;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    embeddingsCache = JSON.parse(raw) as EmbeddingsFile;
    embeddingsCachePath = filePath;
    console.log(`[embeddings] Loaded ${embeddingsCache.node_count} local embeddings (${embeddingsCache.dimension}d)`);
    return embeddingsCache;
  } catch (err) {
    console.warn('[embeddings] Could not load embeddings.json:', err);
    return null;
  }
}

/**
 * Compute embeddings for a list of texts.
 * Accepts an optional parallel array of node IDs. For IDs found in
 * the local embeddings.json, the pre-computed vector is returned directly
 * (no API call needed). Any texts without a local match fall back to the
 * Gemini API.
 */
export async function computeEmbeddings(
  texts: string[],
  ids?: string[],
): Promise<number[][]> {
  const localData = loadEmbeddingsFile();
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const missingIndices: number[] = [];

  // Try local lookup by ID
  if (ids && localData) {
    for (let i = 0; i < texts.length; i++) {
      const nodeId = ids[i];
      if (nodeId && localData.nodes[nodeId]) {
        results[i] = localData.nodes[nodeId].vector;
      } else {
        missingIndices.push(i);
      }
    }
  } else {
    // No IDs provided — everything is missing
    for (let i = 0; i < texts.length; i++) {
      missingIndices.push(i);
    }
  }

  // If there are missing entries, fall back to Gemini API
  if (missingIndices.length > 0) {
    console.log(`[embeddings] ${missingIndices.length} of ${texts.length} texts need API embedding`);
    const missingTexts = missingIndices.map(i => texts[i]);
    const apiVectors = await computeEmbeddingsViaApi(missingTexts);
    for (let j = 0; j < missingIndices.length; j++) {
      results[missingIndices[j]] = apiVectors[j];
    }
  } else {
    console.log(`[embeddings] All ${texts.length} embeddings served from local cache`);
  }

  return results as number[][];
}

/**
 * Compute a query embedding for a single text.
 * Uses the local Python sentence-transformers model (same model as embeddings.json).
 * Falls back to Gemini API if Python is unavailable.
 */
export async function computeQueryEmbedding(text: string): Promise<number[]> {
  try {
    const vector = await computeQueryViaLocalPython(text);
    return vector;
  } catch (err) {
    console.warn('[embeddings] Local Python embedding failed, falling back to Gemini API:', err);
    return computeQueryViaApi(text);
  }
}

// ---------- Update embeddings.json for changed nodes ----------

export interface NodeEmbeddingInput {
  id: string;
  text: string;
  pov: string;
}

/**
 * Re-embed a set of nodes via local Python and update embeddings.json.
 * Runs asynchronously — caller can fire-and-forget.
 */
export async function updateNodeEmbeddings(nodes: NodeEmbeddingInput[]): Promise<void> {
  if (nodes.length === 0) return;

  const filePath = getEmbeddingsPath();
  const items = nodes.map(n => ({ id: n.id, text: n.text }));
  const inputJson = JSON.stringify(items);

  console.log(`[embeddings] Updating ${nodes.length} node embeddings...`);

  // Call Python batch-encode via stdin
  const vectors = await new Promise<Record<string, number[]>>((resolve, reject) => {
    const child = execFile(
      PYTHON,
      [EMBED_SCRIPT, 'batch-encode'],
      { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python batch-encode failed: ${err.message}\n${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, number[]>);
        } catch (parseErr) {
          reject(new Error(`Failed to parse batch-encode output: ${parseErr}`));
        }
      },
    );
    child.stdin!.write(inputJson);
    child.stdin!.end();
  });

  // Read existing embeddings.json (fresh, not from cache)
  let data: EmbeddingsFile;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(raw) as EmbeddingsFile;
  } catch {
    // Create new file structure
    data = {
      model: 'all-MiniLM-L6-v2',
      dimension: 384,
      node_count: 0,
      nodes: {},
    };
  }

  // Merge new vectors
  for (const node of nodes) {
    if (vectors[node.id]) {
      data.nodes[node.id] = {
        pov: node.pov,
        vector: vectors[node.id],
      };
    }
  }
  data.node_count = Object.keys(data.nodes).length;

  // Write back
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`[embeddings] Updated embeddings.json (${data.node_count} total nodes)`);

  // Invalidate in-memory cache so next read picks up new data
  embeddingsCache = null;
  embeddingsCachePath = null;
}

// ---------- NLI cross-encoder classification ----------

export interface NliPair {
  text_a: string;
  text_b: string;
  [key: string]: unknown; // extra fields are preserved
}

export interface NliResult {
  text_a: string;
  text_b: string;
  nli_label: 'entailment' | 'neutral' | 'contradiction';
  nli_entailment: number;
  nli_neutral: number;
  nli_contradiction: number;
  margin: number;
  [key: string]: unknown;
}

/**
 * Classify text pairs as entailment, neutral, or contradiction using the
 * local NLI cross-encoder (cross-encoder/nli-deberta-v3-small).
 * Calls embed_taxonomy.py nli-classify via stdin/stdout.
 */
export async function classifyNli(pairs: NliPair[]): Promise<NliResult[]> {
  if (pairs.length === 0) return [];

  const inputJson = JSON.stringify(pairs);

  return new Promise((resolve, reject) => {
    const child = execFile(
      PYTHON,
      [EMBED_SCRIPT, 'nli-classify'],
      { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`NLI classification failed: ${err.message}\n${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as NliResult[]);
        } catch (parseErr) {
          reject(new Error(`Failed to parse NLI output: ${parseErr}`));
        }
      },
    );
    child.stdin!.write(inputJson);
    child.stdin!.end();
  });
}

// ---------- Local Python embedding ----------

function computeQueryViaLocalPython(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON,
      [EMBED_SCRIPT, 'encode', text],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python embed failed: ${err.message}\n${stderr}`));
          return;
        }
        try {
          const vector = JSON.parse(stdout) as number[];
          if (!Array.isArray(vector) || vector.length === 0) {
            reject(new Error('Python embed returned empty vector'));
            return;
          }
          resolve(vector);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Python output: ${parseErr}`));
        }
      },
    );
  });
}

// ---------- Gemini API fallback ----------

const GEMINI_MODEL = 'gemini-embedding-001';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BATCH_SIZE = 100;
const MAX_RETRIES = 5;

interface GeminiBatchResponse {
  embeddings: { values: number[] }[];
}

async function callGeminiBatchApi(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  apiKey: string,
): Promise<number[][]> {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:batchEmbedContents?key=${apiKey}`;

  const requests = texts.map(text => ({
    model: `models/${GEMINI_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
  }));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (response.status === 429 || response.status === 503) {
      if (attempt === MAX_RETRIES) {
        const label = response.status === 503 ? 'temporarily unavailable' : 'rate limited';
        throw new Error(
          `Gemini Embedding API ${label} after ${MAX_RETRIES} attempts. Please try again later.`,
        );
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[batchEmbed] ${response.status}, retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as GeminiBatchResponse;
    return json.embeddings.map(e => e.values);
  }

  throw new Error('callGeminiBatchApi: exhausted all retry attempts');
}

async function computeEmbeddingsViaApi(texts: string[]): Promise<number[][]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('No API key configured. Set a Gemini API key or run Update-TaxEmbeddings to generate local embeddings.');

  const allVectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await callGeminiBatchApi(batch, 'RETRIEVAL_DOCUMENT', apiKey);
    allVectors.push(...vectors);
  }
  return allVectors;
}

async function computeQueryViaApi(text: string): Promise<number[]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('No API key configured. Set a Gemini API key or install Python with sentence-transformers.');

  const vectors = await callGeminiBatchApi([text], 'RETRIEVAL_QUERY', apiKey);
  return vectors[0];
}

// ---------- Text generation (unchanged) ----------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

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
    const lowerMsg = msg.toLowerCase();

    if (lowerMsg.includes('per minute') || lowerMsg.includes('rpm')) {
      return {
        limitType: 'RPM',
        limitMessage: 'Requests per minute quota exceeded. Retry should succeed in under a minute.',
      };
    }
    if (lowerMsg.includes('tokens per minute') || lowerMsg.includes('tpm')) {
      return {
        limitType: 'TPM',
        limitMessage: 'Tokens per minute quota exceeded. Retry should succeed in under a minute.',
      };
    }
    if (lowerMsg.includes('per day') || lowerMsg.includes('rpd')) {
      return {
        limitType: 'RPD',
        limitMessage: 'Daily request quota exceeded. Try a lighter model, or wait until quota resets (usually midnight PT).',
      };
    }

    if (msg) {
      return { limitType: 'unknown', limitMessage: msg };
    }
  } catch { /* body wasn't JSON */ }

  return {
    limitType: 'unknown',
    limitMessage: 'Rate limited by Gemini API. Retrying with exponential backoff.',
  };
}

type AIBackend = 'gemini' | 'claude' | 'groq';

function resolveBackend(model: string): AIBackend {
  if (model.startsWith('claude')) return 'claude';
  if (model.startsWith('groq')) return 'groq';
  return 'gemini';
}

// ── API model ID mapping — loaded from ai-models.json ──
// Maps friendly IDs (e.g. "claude-sonnet-4-5") to actual API model IDs
// (e.g. "claude-sonnet-4-5-20250514"). Rebuilt on each call from config file.

function loadModelMap(): Record<string, string> {
  try {
    const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as { models: { id: string; apiModelId?: string }[] };
    const map: Record<string, string> = {};
    for (const m of config.models) {
      if (m.apiModelId && m.apiModelId !== m.id) {
        map[m.id] = m.apiModelId;
      }
    }
    return map;
  } catch {
    return {};
  }
}

// Cache the map, reload when ai-models.json changes
let _modelMapCache: Record<string, string> | null = null;
let _modelMapMtime = 0;

function getApiModelId(friendlyId: string): string {
  try {
    const configPath = path.join(PROJECT_ROOT, 'ai-models.json');
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      _modelMapCache = loadModelMap();
      _modelMapMtime = stat.mtimeMs;
      console.log('[embeddings] Reloaded model map from ai-models.json');
    }
  } catch {
    if (!_modelMapCache) _modelMapCache = {};
  }
  return _modelMapCache[friendlyId] || friendlyId;
}

async function generateViaGemini(
  prompt: string,
  model: string,
  apiKey: string,
  onRetry?: (progress: GenerateTextProgress) => void,
  timeoutMs?: number,
): Promise<string> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[generateText] Attempt ${attempt}/${MAX_RETRIES} - Calling Gemini ${model}...`);

    let response: Response;
    try {
      response = await withTimeout(
        net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: _debateTemperature ?? 0.7,
              maxOutputTokens: 16384,
            },
          }),
        }),
        timeoutMs ?? 60_000,
        'Gemini API request',
      );
    } catch (err: unknown) {
      console.error(`[generateText] Fetch failed (attempt ${attempt}/${MAX_RETRIES}):`, err);
      if (attempt === MAX_RETRIES) {
        throw err instanceof Error ? err : new Error(`Gemini API network error: ${err}`);
      }
      const backoff = Math.min(2 ** attempt, 30);
      onRetry?.({
        attempt,
        maxRetries: MAX_RETRIES,
        backoffSeconds: backoff,
        limitType: 'unknown',
        limitMessage: 'Network error. Retrying automatically...',
      });
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    console.log('[generateText] Response status:', response.status);

    if (response.status === 429 || response.status === 503) {
      let retryBody = '';
      try { retryBody = await response.text(); } catch { /* ignore */ }

      if (response.status === 429) {
        const { limitType, limitMessage } = parseRateLimitType(retryBody);
        console.log(`[generateText] Rate limited (429) type=${limitType}: ${limitMessage}`);

        if (attempt === MAX_RETRIES) {
          const prefix = limitType === 'RPD'
            ? 'Daily quota exhausted'
            : `Gemini API rate limited (${limitType}) after ${MAX_RETRIES} attempts`;
          throw new Error(
            `${prefix}. ${limitMessage} Check your quota at https://aistudio.google.com/apikey`,
          );
        }
        const backoff = limitType === 'RPD'
          ? Math.min(2 ** (attempt + 2), 60)
          : Math.min(2 ** attempt, 30);
        console.log(`[generateText] Retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
        onRetry?.({ attempt, maxRetries: MAX_RETRIES, backoffSeconds: backoff, limitType, limitMessage });
        await new Promise(resolve => setTimeout(resolve, backoff * 1000));
        continue;
      }

      // 503 — model temporarily unavailable
      console.log(`[generateText] Service unavailable (503), attempt ${attempt}/${MAX_RETRIES}`);
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Gemini model is temporarily unavailable (503) after ${MAX_RETRIES} attempts. Please try again later.`,
        );
      }
      const backoff = Math.min(2 ** attempt, 30);
      onRetry?.({
        attempt,
        maxRetries: MAX_RETRIES,
        backoffSeconds: backoff,
        limitType: 'unknown',
        limitMessage: 'Model is experiencing high demand. Retrying automatically...',
      });
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    let bodyText: string;
    try {
      bodyText = await withTimeout(response.text(), timeoutMs ? Math.max(timeoutMs / 2, 30_000) : 30_000, 'Reading response body');
    } catch (err) {
      console.error('[generateText] Reading body failed:', err);
      throw err instanceof Error ? err : new Error(`Failed to read response body: ${err}`);
    }

    console.log('[generateText] Body length:', bodyText.length);

    if (!response.ok) {
      console.error('[generateText] API error:', bodyText.slice(0, 300));
      throw new Error(`Gemini API error ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`Gemini API returned invalid JSON: ${bodyText.slice(0, 200)}`);
    }

    const candidates = (json as { candidates?: { content: { parts: { text: string }[] } }[] }).candidates;
    if (!candidates || candidates.length === 0) {
      console.error('[generateText] No candidates:', bodyText.slice(0, 300));
      throw new Error(`No response candidates from Gemini. Body: ${bodyText.slice(0, 200)}`);
    }

    const result = candidates[0].content.parts.map((p) => p.text).join('');
    console.log('[generateText] Success, result length:', result.length);
    return result;
  }

  throw new Error('generateText: exhausted all retry attempts');
}

async function generateViaClaude(
  prompt: string,
  model: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<string> {
  const apiModel = getApiModelId(model);
  const maskedKey = apiKey.length > 12 ? apiKey.slice(0, 8) + '...' + apiKey.slice(-4) : '***';
  console.log(`[Claude] model input: "${model}" → API model: "${apiModel}"`);
  console.log(`[Claude] API key prefix: ${maskedKey}`);
  console.log(`[Claude] URL: https://api.anthropic.com/v1/messages`);
  console.log(`[Claude] anthropic-version: 2023-06-01`);

  const requestBody = {
    model: apiModel,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt.slice(0, 100) + '...' }],
  };
  console.log(`[Claude] Request body (truncated):`, JSON.stringify(requestBody, null, 2));

  const response = await withTimeout(
    net.fetch('https://api.anthropic.com/v1/messages', {
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

  console.log(`[Claude] Response status: ${response.status}`);
  console.log(`[Claude] Response headers:`, Object.fromEntries(response.headers.entries()));

  const bodyText = await withTimeout(response.text(), timeoutMs ? Math.max(timeoutMs / 2, 30_000) : 30_000, 'Reading Claude response');
  console.log(`[Claude] Response body (first 500):`, bodyText.slice(0, 500));

  if (!response.ok) {
    throw new Error(`Claude API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = JSON.parse(bodyText) as { content?: { type: string; text: string }[] };
  if (!json.content || json.content.length === 0) {
    throw new Error(`No content in Claude response: ${bodyText.slice(0, 200)}`);
  }

  const result = json.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
  console.log('[generateText] Claude success, result length:', result.length);
  return result;
}

async function generateViaGroq(
  prompt: string,
  model: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<string> {
  const apiModel = getApiModelId(model);
  console.log(`[generateText] Calling Groq ${apiModel}...`);

  const response = await withTimeout(
    net.fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
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

  const bodyText = await withTimeout(response.text(), timeoutMs ? Math.max(timeoutMs / 2, 30_000) : 30_000, 'Reading Groq response');

  if (!response.ok) {
    throw new Error(`Groq API error ${response.status}: ${bodyText.slice(0, 500)}`);
  }

  const json = JSON.parse(bodyText) as { choices?: { message: { content: string } }[] };
  if (!json.choices || json.choices.length === 0) {
    throw new Error(`No choices in Groq response: ${bodyText.slice(0, 200)}`);
  }

  const result = json.choices[0].message.content;
  console.log('[generateText] Groq success, result length:', result.length);
  return result;
}

let _lastLoggedModel: string | null = null;
let _debateTemperature: number | null = null;

/** Set the temperature for debate AI calls. Pass null to reset to default (0.7). */
export function setDebateTemperature(temp: number | null): void {
  _debateTemperature = temp;
  if (temp !== null) console.log(`[AI] Debate temperature set to: ${temp}`);
  else console.log('[AI] Debate temperature reset to default (0.7)');
}

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (progress: GenerateTextProgress) => void,
  timeoutMs?: number,
): Promise<string> {
  const DEFAULT_GENERATE_MODEL = 'gemini-3.1-flash-lite-preview';
  const resolvedModel = model || DEFAULT_GENERATE_MODEL;
  const backend = resolveBackend(resolvedModel);

  const apiKey = loadApiKey(backend);
  const keySource = apiKey ? 'Electron encrypted store' : '(not found)';
  if (!apiKey) {
    const names: Record<AIBackend, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq' };
    throw new Error(`No ${names[backend]} API key configured. Set it in Settings.`);
  }

  // Log on first call or model change
  if (_lastLoggedModel !== resolvedModel) {
    if (_lastLoggedModel) {
      console.log(`[AI] Model changed: ${_lastLoggedModel} → ${resolvedModel} | Backend: ${backend} | Key source: ${keySource}`);
    } else {
      console.log(`[AI] Backend: ${backend} | Model: ${resolvedModel} | Key source: ${keySource}`);
    }
    _lastLoggedModel = resolvedModel;
  }

  switch (backend) {
    case 'claude':
      return generateViaClaude(prompt, resolvedModel, apiKey, timeoutMs);
    case 'groq':
      return generateViaGroq(prompt, resolvedModel, apiKey, timeoutMs);
    default:
      return generateViaGemini(prompt, resolvedModel, apiKey, onRetry, timeoutMs);
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

/**
 * Generate text with Gemini Google Search grounding enabled.
 * Used for fact-checking where external verification improves accuracy.
 * Falls back to regular generateText for non-Gemini backends.
 */
export async function generateTextWithSearch(
  prompt: string,
  model?: string,
): Promise<{ text: string; searchQueries?: string[]; citations?: GroundingCitation[] }> {
  const DEFAULT_GENERATE_MODEL = 'gemini-3.1-flash-lite-preview';
  const resolvedModel = model || DEFAULT_GENERATE_MODEL;
  const backend = resolveBackend(resolvedModel);

  // Only Gemini supports built-in search grounding
  if (backend !== 'gemini') {
    const text = await generateText(prompt, resolvedModel);
    return { text };
  }

  const apiKey = loadApiKey(backend);
  if (!apiKey) throw new Error('No Gemini API key configured.');

  const apiModel = getApiModelId(resolvedModel);
  const url = `${GEMINI_BASE}/${apiModel}:generateContent?key=${apiKey}`;

  console.log(`[AI] Grounded search: ${resolvedModel} with google_search tool`);

  const response = await withTimeout(
    net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 16384,
        },
      }),
    }),
    60_000,
    'Gemini grounded search request',
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini search grounding error ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = await response.json() as Record<string, unknown>;
  const candidates = (json as {
    candidates?: {
      content: { parts: { text: string }[] };
      groundingMetadata?: {
        searchEntryPoint?: { renderedContent?: string };
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        groundingSupports?: {
          segment?: { startIndex?: number; endIndex?: number; text?: string };
          groundingChunkIndices?: number[];
          confidenceScores?: number[];
        }[];
      };
    }[];
  }).candidates;
  if (!candidates?.length) throw new Error('No candidates from Gemini grounded search');

  let text = candidates[0].content.parts
    .filter(p => typeof p.text === 'string')
    .map(p => p.text)
    .join('');
  const meta = candidates[0].groundingMetadata;
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
