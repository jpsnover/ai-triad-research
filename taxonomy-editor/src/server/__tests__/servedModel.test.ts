// @vitest-environment node
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4067 — generateText result includes servedModel (registry id of the chain link that answered).
// Two arms:
//   1. Happy path: primary model answers → servedModel equals the requested registry id.
//   2. Fallback path: primary throws, fallback answers → servedModel equals the fallback id, not the primary.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callWithKeyRotationMock, recordMock } = vi.hoisted(() => ({
  callWithKeyRotationMock: vi.fn(),
  recordMock: vi.fn(),
}));

// Keep real config (model registry loads from disk) but hand back a key so we
// don't short-circuit on "no API key for backend".
vi.mock('../config.js', async (importActual) => {
  const actual = await importActual<typeof import('../config.js')>();
  return {
    ...actual,
    getApiKey: vi.fn(async () => 'fake-key'),
    getApiKeys: vi.fn(async () => ['fake-key']),
  };
});

// Bypass callWithKeyRotation so we control the per-attempt outcome without
// fighting withRetry's retry ladder (SERVER_RETRY_CONFIG has maxRetries: 5).
vi.mock('../ai/keyRotator.js', () => ({ callWithKeyRotation: callWithKeyRotationMock }));

vi.mock('../logger.js', () => ({
  log: {
    api: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    server: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
  getRequestId: () => 'req-test',
  LOG_MAX_LINE_BYTES: 65536,
}));

vi.mock('../../../../lib/flight-recorder/index.js', () => ({ getGlobalRecorder: () => ({ record: recordMock }) }));

import { generateText } from '../ai/aiBackends.js';

beforeEach(() => {
  callWithKeyRotationMock.mockReset();
  recordMock.mockReset();
});

describe('t/4067 — servedModel in generateText result', () => {
  it('happy path: servedModel equals the requested registry id when the primary model answers', async () => {
    callWithKeyRotationMock.mockResolvedValue({ text: 'response text', usage: undefined });

    const result = await generateText('prompt', 'gemini-3.5-flash-lite');

    expect(result.text).toBe('response text');
    expect(result.servedModel).toBe('gemini-3.5-flash-lite');
  });

  it('fallback path: servedModel equals the fallback registry id, not the primary', async () => {
    // claude-haiku-4-5 fallback chain (from ai-models.json): [gemini-3.5-flash-lite, ...]
    // First invocation (claude-haiku-4-5) throws; second (gemini-3.5-flash-lite) answers.
    callWithKeyRotationMock
      .mockRejectedValueOnce(new Error('upstream error'))
      .mockResolvedValueOnce({ text: 'fallback answer', usage: undefined });

    const result = await generateText('prompt', 'claude-haiku-4-5');

    expect(result.text).toBe('fallback answer');
    expect(result.servedModel).toBe('gemini-3.5-flash-lite');
    expect(result.servedModel).not.toBe('claude-haiku-4-5');
  });
});
