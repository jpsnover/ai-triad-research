// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { loadApiKey } from './apiKeyStore';
import { net } from 'electron';
import { PROJECT_ROOT } from './fileIO';
import { ActionableError } from '../../../lib/debate/errors';
console.log('[embeddings] About to import tavily...');
import { tavilySearch, buildSearchAugmentedPrompt } from '../../../lib/search/tavily';
console.log('[embeddings] Tavily import OK');

// ── Shared AI-client imports ──
import {
  withTimeout,
  resolveBackend,
  GEMINI_BASE,
  GEMINI_SAFETY_SETTINGS,
  buildModelIdMap,
  getApiModelId,
  callProvider,
  withRetry,
  SERVER_RETRY_CONFIG,
} from '../../../lib/ai-client';
import type { GenerateOptions, RateLimitType as SharedRateLimitType, FetchFn } from '../../../lib/ai-client';
import type { ModelRegistry } from '../../../lib/ai-client';

// ── Electron net.fetch wrapper ──
// Electron's net.fetch requires Buffer.from for string bodies in some cases.
const electronFetch: FetchFn = ((url: RequestInfo | URL, init?: RequestInit) => {
  if (init?.body && typeof init.body === 'string') {
    return net.fetch(url as string, { ...init, body: Buffer.from(init.body, 'utf-8') });
  }
  return net.fetch(url as string, init as Parameters<typeof net.fetch>[1]);
}) as FetchFn;

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

  // Merge new vectors (with dimension validation)
  const expectedDim = data.dimension || 384;
  for (const node of nodes) {
    if (vectors[node.id]) {
      const vec = vectors[node.id];
      if (vec.length !== expectedDim) {
        console.warn(`[embeddings] Dimension mismatch for ${node.id}: got ${vec.length}, expected ${expectedDim} — skipping`);
        continue;
      }
      data.nodes[node.id] = {
        pov: node.pov,
        vector: vec,
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
// GEMINI_BASE is imported from shared lib/ai-client
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
      body: Buffer.from(JSON.stringify({ requests }), 'utf-8'),
    });

    if (response.status === 429 || response.status === 503) {
      if (attempt === MAX_RETRIES) {
        const label = response.status === 503 ? 'temporarily unavailable' : 'rate limited';
        throw new ActionableError({
          goal: 'Batch-embed texts via Gemini Embedding API',
          problem: `Gemini Embedding API ${label} after ${MAX_RETRIES} attempts.`,
          location: 'embeddings.callGeminiBatchApi',
          nextSteps: [
            'Wait a few minutes and try again.',
            'Check your Gemini API quota at https://aistudio.google.com/apikey',
            'Consider using local Python embeddings with Update-TaxEmbeddings.',
          ],
        });
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[batchEmbed] ${response.status}, retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ActionableError({
        goal: 'Batch-embed texts via Gemini Embedding API',
        problem: `Gemini API error ${response.status}: ${body}`,
        location: 'embeddings.callGeminiBatchApi',
        nextSteps: [
          'Check the API response status and error message above.',
          'Verify your Gemini API key is valid in Settings.',
          'Check your quota at https://aistudio.google.com/apikey',
        ],
      });
    }

    const json = (await response.json()) as GeminiBatchResponse;
    return json.embeddings.map(e => e.values);
  }

  throw new ActionableError({
    goal: 'Batch-embed texts via Gemini Embedding API',
    problem: 'Exhausted all retry attempts without a successful response.',
    location: 'embeddings.callGeminiBatchApi',
    nextSteps: [
      'Wait a few minutes and try again.',
      'Check your network connection and Gemini API status.',
      'Consider using local Python embeddings with Update-TaxEmbeddings.',
    ],
  });
}

const EXPECTED_DIMENSION = 384;

async function computeEmbeddingsViaApi(texts: string[]): Promise<number[][]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new ActionableError({
    goal: 'Compute embeddings via Gemini API',
    problem: 'No Gemini API key configured.',
    location: 'embeddings.computeEmbeddingsViaApi',
    nextSteps: [
      'Set a Gemini API key in Settings.',
      'Or run Update-TaxEmbeddings to generate local embeddings without an API key.',
    ],
  });

  const allVectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await callGeminiBatchApi(batch, 'RETRIEVAL_DOCUMENT', apiKey);
    if (vectors.length > 0 && vectors[0].length !== EXPECTED_DIMENSION) {
      console.warn(`[embeddings] API returned ${vectors[0].length}-dim vectors, expected ${EXPECTED_DIMENSION}. Cosine similarity against local embeddings may be unreliable.`);
    }
    allVectors.push(...vectors);
  }
  return allVectors;
}

async function computeQueryViaApi(text: string): Promise<number[]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new ActionableError({
    goal: 'Compute query embedding via Gemini API',
    problem: 'No Gemini API key configured.',
    location: 'embeddings.computeQueryViaApi',
    nextSteps: [
      'Set a Gemini API key in Settings.',
      'Or install Python with sentence-transformers for local embeddings.',
    ],
  });

  const vectors = await callGeminiBatchApi([text], 'RETRIEVAL_QUERY', apiKey);
  return vectors[0];
}

// ---------- Text generation — delegates to shared lib/ai-client ----------

// Re-export RateLimitType from the shared package for consumers
export type RateLimitType = SharedRateLimitType;

export interface GenerateTextProgress {
  attempt: number;
  maxRetries: number;
  backoffSeconds: number;
  limitType: RateLimitType;
  limitMessage: string;
}

type AIBackend = 'gemini' | 'claude' | 'groq' | 'openai';

// ── API model ID mapping — loaded from ai-models.json via shared buildModelIdMap ──

/** Find ai-models.json — may be at PROJECT_ROOT or one level up (when PROJECT_ROOT is taxonomy-editor/) */
function findModelsConfig(): string {
  const candidates = [
    path.join(PROJECT_ROOT, 'ai-models.json'),
    path.join(PROJECT_ROOT, '..', 'ai-models.json'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  return candidates[0];
}

// Cache the model ID map, reload when ai-models.json changes
let _modelMapCache: Record<string, string> | null = null;
let _modelMapMtime = 0;

function resolveApiModelId(friendlyId: string): string {
  try {
    const configPath = findModelsConfig();
    const stat = fs.statSync(configPath);
    if (!_modelMapCache || stat.mtimeMs !== _modelMapMtime) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw) as ModelRegistry;
      _modelMapCache = buildModelIdMap(config);
      _modelMapMtime = stat.mtimeMs;
      console.log(`[model-map] Loaded ${Object.keys(_modelMapCache!).length} mappings from ${configPath}`);
    }
  } catch (err) {
    if (!_modelMapCache) _modelMapCache = {};
    console.error(`[model-map] FAILED to load model map: ${err instanceof Error ? err.message : err}`);
  }
  return getApiModelId(_modelMapCache!, friendlyId);
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
  temperature?: number,
): Promise<string> {
  const DEFAULT_GENERATE_MODEL = 'gemini-3.1-flash-lite-preview';
  const friendlyModel = model || DEFAULT_GENERATE_MODEL;
  const backend = resolveBackend(friendlyModel);
  const resolvedModel = resolveApiModelId(friendlyModel);

  const apiKey = loadApiKey(backend);
  const keySource = apiKey ? 'Electron encrypted store' : '(not found)';
  if (!apiKey) {
    const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI' };
    const backendName = names[backend] ?? backend;
    throw new ActionableError({
      goal: `Generate text via ${backendName} API`,
      problem: `No ${backendName} API key configured.`,
      location: 'embeddings.generateText',
      nextSteps: [
        `Set a ${backendName} API key in Settings.`,
        'Or switch to a different AI backend that has a key configured.',
      ],
    });
  }

  // Log on first call or model change
  if (_lastLoggedModel !== friendlyModel) {
    if (_lastLoggedModel) {
      console.log(`[AI] Model changed: ${_lastLoggedModel} → ${friendlyModel} (API: ${resolvedModel}) | Backend: ${backend} | Key source: ${keySource}`);
    } else {
      console.log(`[AI] Backend: ${backend} | Model: ${friendlyModel} (API: ${resolvedModel}) | Key source: ${keySource}`);
    }
    _lastLoggedModel = friendlyModel;
  }

  const opts: GenerateOptions = {
    temperature: temperature ?? _debateTemperature ?? 0.7,
    timeoutMs: timeoutMs,
  };

  const result = await withRetry(
    () => callProvider(electronFetch, backend, prompt, resolvedModel, apiKey, opts),
    SERVER_RETRY_CONFIG,
    `${backend}/${resolvedModel}`,
    (msg: string) => {
      console.log(msg);
      // Parse retry info from the log message to feed the onRetry callback
      const attemptMatch = msg.match(/attempt (\d+)\/(\d+).*waiting (\d+)s/);
      if (attemptMatch && onRetry) {
        onRetry({
          attempt: parseInt(attemptMatch[1], 10),
          maxRetries: parseInt(attemptMatch[2], 10),
          backoffSeconds: parseInt(attemptMatch[3], 10),
          limitType: 'unknown',
          limitMessage: msg,
        });
      }
    },
  );

  console.log('[generateText] Success, result length:', result.text.length);
  return result.text;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export async function generateChatStream(
  systemInstruction: string,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  model?: string,
  temperature?: number,
): Promise<string> {
  const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
  const friendlyModel = model || DEFAULT_MODEL;
  const backend = resolveBackend(friendlyModel);
  const resolvedModel = resolveApiModelId(friendlyModel);

  const apiKey = loadApiKey(backend);
  if (!apiKey) {
    const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openai: 'OpenAI' };
    const backendName = names[backend] ?? backend;
    throw new ActionableError({
      goal: `Stream chat response via ${backendName} API`,
      problem: `No ${backendName} API key configured.`,
      location: 'embeddings.generateChatStream',
      nextSteps: [
        `Set a ${backendName} API key in Settings.`,
        'Or switch to a different AI backend that has a key configured.',
      ],
    });
  }

  if (backend !== 'gemini') {
    const prompt = systemInstruction + '\n\n' + messages.map(m =>
      m.role === 'user' ? `[User]: ${m.content}` : `[Assistant]: ${m.content}`
    ).join('\n\n') + '\n\n[Assistant]:';
    const defaultTimeout = backend === 'groq' ? 60_000 : 120_000;
    const opts: GenerateOptions = {
      temperature: temperature ?? 0.7,
      timeoutMs: defaultTimeout,
    };
    const providerResult = await callProvider(electronFetch, backend, prompt, resolvedModel, apiKey, opts);
    onChunk(providerResult.text);
    return providerResult.text;
  }

  const url = `${GEMINI_BASE}/${resolvedModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const contents = messages.map(m => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const _streamBody = JSON.stringify({
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature: temperature ?? 0.3,
      maxOutputTokens: 16384,
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });
  const response = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(_streamBody, 'utf-8'),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new ActionableError({
      goal: 'Stream chat response via Gemini API',
      problem: `Gemini API error ${response.status}: ${errBody.slice(0, 500)}`,
      location: 'embeddings.generateChatStream',
      nextSteps: [
        'Check the API response status and error message above.',
        'Verify your Gemini API key is valid in Settings.',
        'If rate limited, wait a moment and try again.',
      ],
    });
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ActionableError({
    goal: 'Stream chat response via Gemini API',
    problem: 'No response body reader available from the Gemini streaming response.',
    location: 'embeddings.generateChatStream',
    nextSteps: [
      'This may indicate a network or Electron fetch issue.',
      'Try again or restart the application.',
      'If the problem persists, switch to a non-streaming backend.',
    ],
  });

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          onChunk(text);
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  if (buffer.startsWith('data: ')) {
    const json = buffer.slice(6).trim();
    if (json && json !== '[DONE]') {
      try {
        const parsed = JSON.parse(json) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          onChunk(text);
        }
      } catch { /* skip */ }
    }
  }

  console.log(`[chatStream] Complete, total length: ${fullText.length}`);
  return fullText;
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
 * Tavily search + LLM pipeline: search the web via Tavily, then pass
 * the results as context to the current AI model for grounded generation.
 */
async function generateWithTavily(
  prompt: string,
  model: string,
  tavilyKey: string,
): Promise<{ text: string; searchQueries?: string[]; citations?: GroundingCitation[] }> {
  const searchQuery = prompt.length > 400 ? prompt.slice(0, 400) : prompt;
  console.log(`[AI] Tavily search for model=${model}, query length=${searchQuery.length}`);

  const searchResult = await tavilySearch(searchQuery, tavilyKey, {
    maxResults: 5,
    includeAnswer: true,
    searchDepth: 'basic',
  }, net.fetch as unknown as typeof fetch);

  const { augmentedPrompt, searchQueries, citations: searchCitations } = buildSearchAugmentedPrompt(prompt, searchResult);

  const text = await generateText(augmentedPrompt, model);

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

/**
 * Generate text with web search grounding.
 * Gemini: uses built-in google_search tool.
 * Other backends: uses Tavily search + LLM if TAVILY_API_KEY is available.
 * Falls back to regular generateText when no search provider is available.
 */
export async function generateTextWithSearch(
  prompt: string,
  model?: string,
): Promise<{ text: string; searchQueries?: string[]; citations?: GroundingCitation[] }> {
  const DEFAULT_GENERATE_MODEL = 'gemini-3.1-flash-lite-preview';
  const resolvedModel = model || DEFAULT_GENERATE_MODEL;
  const backend = resolveBackend(resolvedModel);

  // Non-Gemini: use Tavily search + LLM if Tavily key is available
  if (backend !== 'gemini') {
    const tavilyKey = loadApiKey('tavily') || process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      return generateWithTavily(prompt, resolvedModel, tavilyKey);
    }
    const text = await generateText(prompt, resolvedModel);
    return { text };
  }

  const apiKey = loadApiKey(backend);
  if (!apiKey) throw new ActionableError({
    goal: 'Generate text with web search grounding via Gemini',
    problem: 'No Gemini API key configured.',
    location: 'embeddings.generateTextWithSearch',
    nextSteps: [
      'Set a Gemini API key in Settings.',
      'Or switch to a different AI backend with a Tavily key for search grounding.',
    ],
  });

  const apiModel = resolveApiModelId(resolvedModel);
  const url = `${GEMINI_BASE}/${apiModel}:generateContent?key=${apiKey}`;

  console.log(`[AI] Grounded search: ${resolvedModel} with google_search tool`);

  const _searchBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
    },
    safetySettings: GEMINI_SAFETY_SETTINGS,
  });
  const response = await withTimeout(
    electronFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: _searchBody,
    }),
    60_000,
    'Gemini grounded search request',
  );

  if (!response.ok) {
    const body = await response.text();
    throw new ActionableError({
      goal: 'Generate text with web search grounding via Gemini',
      problem: `Gemini search grounding error ${response.status}: ${body.slice(0, 300)}`,
      location: 'embeddings.generateTextWithSearch',
      nextSteps: [
        'Check the API response status and error message above.',
        'Verify your Gemini API key is valid in Settings.',
        'The google_search tool may not be available for this model. Try a different model.',
      ],
    });
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
  if (!candidates?.length) throw new ActionableError({
    goal: 'Generate text with web search grounding via Gemini',
    problem: 'No candidates returned from Gemini grounded search.',
    location: 'embeddings.generateTextWithSearch',
    nextSteps: [
      'The model may have filtered the response due to safety settings.',
      'Try rephrasing the prompt or using a different model.',
      'Retry the request — this may be a transient issue.',
    ],
  });

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
