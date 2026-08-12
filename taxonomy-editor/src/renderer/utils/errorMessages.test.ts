// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { mapErrorToUserMessage } from './errorMessages';
import { ActionableError } from '@lib/debate/errors';

describe('mapErrorToUserMessage — ActionableError surfaces .problem, not the raw block (t/2491)', () => {
  it('returns the one-line problem, not the full Goal/Error/Location/Resolve message', () => {
    const err = new ActionableError({
      goal: 'Stream chat response',
      problem: 'Rate limit exceeded. Retry in 30s.',
      location: 'web-bridge.startChatStream',
      nextSteps: ['Wait for the rate limit to reset', 'Use your own API key'],
    });
    // Sanity: the raw .message IS the formatted block we must NOT show.
    expect(err.message).toMatch(/Goal:|Resolve:|Location:/);

    const shown = mapErrorToUserMessage(err);
    expect(shown).toBe('Rate limit exceeded. Retry in 30s.');
    expect(shown).not.toMatch(/Goal:|Location:|Resolve:/);
  });

  it('a missing-key 422 ActionableError shows only its problem line', () => {
    const err = new ActionableError({
      goal: 'Stream chat response',
      problem: 'No API key configured for the selected backend.',
      location: 'web-bridge.startChatStream',
      nextSteps: ['Open Settings → API Keys'],
    });
    expect(mapErrorToUserMessage(err)).toBe('No API key configured for the selected backend.');
  });

  it('non-ActionableError paths are unchanged (rate-limit heuristic still maps)', () => {
    expect(mapErrorToUserMessage(new Error('HTTP 429 rate limit'))).toMatch(/rate limited/i);
  });

  it('a plain string error is returned mapped, not crashed', () => {
    expect(typeof mapErrorToUserMessage('something went wrong')).toBe('string');
  });
});
