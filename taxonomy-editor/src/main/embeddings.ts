import { loadApiKey } from './apiKeyStore';
import { net } from 'electron';

const GEMINI_MODEL = 'gemini-embedding-001';
const DEFAULT_GENERATE_MODEL = 'gemini-2.0-flash';
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

export async function computeEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await callGeminiBatchApi(batch, 'RETRIEVAL_DOCUMENT', apiKey);
    allVectors.push(...vectors);
  }

  return allVectors;
}

export async function computeQueryEmbedding(text: string): Promise<number[]> {
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const vectors = await callGeminiBatchApi([text], 'RETRIEVAL_QUERY', apiKey);
  return vectors[0];
}

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
