// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { loadApiKey } from './apiKeyStore';

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
