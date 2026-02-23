import { loadApiKey } from './apiKeyStore';

const GEMINI_MODEL = 'gemini-embedding-001';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BATCH_SIZE = 100;

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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return callGeminiBatchApi(texts, taskType, apiKey);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${body}`);
  }

  const json = (await response.json()) as GeminiBatchResponse;
  return json.embeddings.map(e => e.values);
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
