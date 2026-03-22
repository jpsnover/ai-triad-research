// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { loadApiKey } from './apiKeyStore';
import { net } from 'electron';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const EMBED_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'embed_taxonomy.py');

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
  // Import fileIO's active taxonomy dir logic
  const TAXONOMY_BASE = path.join(PROJECT_ROOT, 'taxonomy');
  // Read the same active dir that fileIO uses — default to Origin
  const originDir = path.join(TAXONOMY_BASE, 'Origin');
  return path.join(originDir, 'embeddings.json');
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
      'python3',
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

// ---------- Local Python embedding ----------

function computeQueryViaLocalPython(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'python3',
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
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) {
        throw new Error(
          'Gemini Embedding API rate limited after ' + MAX_RETRIES + ' attempts. ' +
          'Please wait a minute and try again.',
        );
      }
      const backoff = Math.min(2 ** attempt, 30);
      console.log(`[batchEmbed] Rate limited (429), retrying in ${backoff}s (attempt ${attempt}/${MAX_RETRIES})`);
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

export async function generateText(
  prompt: string,
  model?: string,
  onRetry?: (progress: GenerateTextProgress) => void,
): Promise<string> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const DEFAULT_GENERATE_MODEL = 'gemini-3.1-flash-lite-preview';
  const resolvedModel = model || DEFAULT_GENERATE_MODEL;
  console.log(`[generateText] Using model: ${resolvedModel}`);
  const url = `${GEMINI_BASE}/${resolvedModel}:generateContent?key=${apiKey}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[generateText] Attempt ${attempt}/${MAX_RETRIES} - Calling Gemini generateContent...`);

    let response: Response;
    try {
      response = await withTimeout(
        net.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 8192,
            },
          }),
        }),
        60_000,
        'Gemini API request',
      );
    } catch (err: unknown) {
      console.error('[generateText] Fetch failed:', err);
      throw err instanceof Error ? err : new Error(`Gemini API network error: ${err}`);
    }

    console.log('[generateText] Response status:', response.status);

    if (response.status === 429) {
      let rateLimitBody = '';
      try { rateLimitBody = await response.text(); } catch { /* ignore */ }
      const { limitType, limitMessage } = parseRateLimitType(rateLimitBody);
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

    let bodyText: string;
    try {
      bodyText = await withTimeout(response.text(), 30_000, 'Reading response body');
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
