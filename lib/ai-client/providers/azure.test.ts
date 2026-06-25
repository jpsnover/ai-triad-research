// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateViaAzure } from './azure.js';
import type { GenerateOptions } from '../types.js';

const OPTS: GenerateOptions = { timeoutMs: 30_000 };

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('generateViaAzure', () => {
  const savedEndpoint = process.env.AZURE_OPENAI_ENDPOINT;

  beforeEach(() => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://my-resource.openai.azure.com';
  });

  afterEach(() => {
    if (savedEndpoint !== undefined) {
      process.env.AZURE_OPENAI_ENDPOINT = savedEndpoint;
    } else {
      delete process.env.AZURE_OPENAI_ENDPOINT;
    }
  });

  it('sends request with correct URL and api-key header', async () => {
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: 'Hello' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    await generateViaAzure(fetchFn, 'test prompt', 'gpt-4o', 'test-key', OPTS);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21');
    expect(init.headers['api-key']).toBe('test-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('returns text and usage from successful response', async () => {
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: 'Generated text' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS);

    expect(result.text).toBe('Generated text');
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it('includes system message when provided', async () => {
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });

    await generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', {
      ...OPTS,
      systemMessage: 'You are a helpful assistant',
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'prompt' });
  });

  it('enables JSON mode when jsonMode is set', async () => {
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: '{"key": "value"}' } }],
    });

    await generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', {
      ...OPTS,
      jsonMode: true,
    });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('strips trailing slashes from endpoint', async () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://my-resource.openai.azure.com///';
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });

    await generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS);

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url.startsWith('https://my-resource.openai.azure.com/openai/')).toBe(true);
  });

  it('throws ActionableError when endpoint is not set', async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    const fetchFn = mockFetch(200, {});

    await expect(generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS))
      .rejects.toThrow('AZURE_OPENAI_ENDPOINT');
  });

  it('throws ActionableError on 429 rate limit', async () => {
    const fetchFn = mockFetch(429, 'Rate limited');

    await expect(generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS))
      .rejects.toThrow('429');
  });

  it('throws ActionableError on 401 auth error', async () => {
    const fetchFn = mockFetch(401, 'Unauthorized');

    await expect(generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS))
      .rejects.toThrow('401');
  });

  it('throws ActionableError on invalid JSON response', async () => {
    const fetchFn = mockFetch(200, 'not json {{{');

    await expect(generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS))
      .rejects.toThrow('invalid JSON');
  });

  it('throws ActionableError when no choices in response', async () => {
    const fetchFn = mockFetch(200, { choices: [] });

    await expect(generateViaAzure(fetchFn, 'prompt', 'gpt-4o', 'key', OPTS))
      .rejects.toThrow('No choices');
  });

  it('uses deployment name from apiModelId in URL', async () => {
    const fetchFn = mockFetch(200, {
      choices: [{ message: { content: 'ok' } }],
    });

    await generateViaAzure(fetchFn, 'prompt', 'my-custom-deployment', 'key', OPTS);

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/deployments/my-custom-deployment/');
  });
});
