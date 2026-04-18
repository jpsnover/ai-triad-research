// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Tavily Search API client — provides web search for fact-checking
 * when Gemini's built-in google_search grounding is unavailable
 * (e.g., when using Claude or Groq as the AI backend).
 *
 * API docs: https://docs.tavily.com/documentation/api-reference/search
 */

const TAVILY_API = 'https://api.tavily.com/search';

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
}

export interface TavilySearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeAnswer?: boolean;
  topic?: 'general' | 'news';
  timeoutMs?: number;
}

export async function tavilySearch(
  query: string,
  apiKey: string,
  options?: TavilySearchOptions,
  fetchFn?: typeof fetch,
): Promise<TavilySearchResponse> {
  const doFetch = fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 30_000;

  const body = {
    query,
    api_key: apiKey,
    max_results: options?.maxResults ?? 5,
    search_depth: options?.searchDepth ?? 'basic',
    include_answer: options?.includeAnswer ?? true,
    topic: options?.topic ?? 'general',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(TAVILY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Tavily API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const json = await response.json() as {
      query: string;
      answer?: string;
      results?: { title: string; url: string; content: string; score: number; raw_content?: string }[];
    };

    return {
      query: json.query,
      answer: json.answer,
      results: (json.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        raw_content: r.raw_content,
      })),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a grounded prompt by prepending Tavily search results as context.
 * Returns the augmented prompt and the search metadata.
 */
export function buildSearchAugmentedPrompt(
  originalPrompt: string,
  searchResults: TavilySearchResponse,
): { augmentedPrompt: string; searchQueries: string[]; citations: { uri: string; title: string }[] } {
  const citations = searchResults.results.map(r => ({ uri: r.url, title: r.title }));

  const contextBlock = searchResults.results
    .map((r, i) => `[Source ${i + 1}: ${r.title}]\nURL: ${r.url}\n${r.content}`)
    .join('\n\n');

  const answerBlock = searchResults.answer
    ? `\nSearch summary: ${searchResults.answer}\n`
    : '';

  const augmentedPrompt =
    `The following web search results are provided as context for your response. ` +
    `Cite sources by number when making factual claims.\n\n` +
    `--- WEB SEARCH RESULTS ---\n${contextBlock}\n${answerBlock}--- END SEARCH RESULTS ---\n\n` +
    originalPrompt;

  return {
    augmentedPrompt,
    searchQueries: [searchResults.query],
    citations,
  };
}
