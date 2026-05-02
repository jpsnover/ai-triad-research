// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ActionableError } from '../../debate/errors.js';
import { withTimeout } from '../retry.js';
import type { FetchFn } from '../types.js';
import { GEMINI_BASE, GEMINI_SAFETY_SETTINGS } from './gemini.js';

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

export interface GroundedSearchResult {
  text: string;
  searchQueries?: string[];
  citations?: GroundingCitation[];
}

export async function geminiGroundedSearch(
  fetchFn: FetchFn,
  prompt: string,
  apiModelId: string,
  apiKey: string,
): Promise<GroundedSearchResult> {
  const url = `${GEMINI_BASE}/${apiModelId}:generateContent?key=${apiKey}`;

  const response = await withTimeout(
    fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 16384 },
        safetySettings: GEMINI_SAFETY_SETTINGS,
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
      location: 'ai-client.geminiGroundedSearch',
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
      location: 'ai-client.geminiGroundedSearch',
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
