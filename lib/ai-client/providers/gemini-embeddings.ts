// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { withRetry, type RetryConfig, SERVER_RETRY_CONFIG } from '../retry';
import type { FetchFn } from '../types';
import { GEMINI_BASE } from './gemini';

const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

export async function callGeminiBatchEmbed(
  fetchFn: FetchFn,
  texts: string[],
  taskType: string,
  apiKey: string,
  retryConfig: RetryConfig = SERVER_RETRY_CONFIG,
): Promise<number[][]> {
  const url = `${GEMINI_BASE}/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${apiKey}`;
  const requests = texts.map(text => ({
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
  }));

  return withRetry(async () => {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (response.status === 429 || response.status === 503) {
      throw new Error(`Gemini embedding API ${response.status}`);
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini embedding API error ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = await response.json() as { embeddings: { values: number[] }[] };
    return json.embeddings.map(e => e.values);
  }, retryConfig, 'gemini-embedding');
}
