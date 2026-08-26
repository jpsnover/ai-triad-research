// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3020 — a Claude monthly-quota-exhaustion error arrives as HTTP 400 `invalid_request_error`
// (not an auth/model fault). Before the fix it fell into the generic error whose "Check your API
// key / Verify the model ID" Resolve steps misattributed the cause (t/2985 pattern class). These
// lock the quota-specific mapping: the reset date is surfaced and the steps say wait / upgrade /
// switch backend — and the branch stays narrow (a non-quota 400 keeps the generic steps).

import { describe, it, expect } from 'vitest';
import { generateViaClaude } from './claude.js';
import { ActionableError } from '../../debate/errors.js';
import type { FetchFn } from '../types.js';

function makeFetch(bodyText: string, status: number): FetchFn {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyText,
    body: null,
  } as unknown as Response);
}

// The exact body Diagnostics captured on debate 3a02e301 (t/3020 incident).
const QUOTA_BODY = JSON.stringify({
  type: 'invalid_request_error',
  message: 'You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC.',
});

// The REAL Anthropic 400 wire format nests the code under `error` (t/3028): the detection is
// substring-based, so it must fire on the nested envelope too — this locks that against a refactor.
const QUOTA_BODY_NESTED = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC.',
  },
});

async function callFor(bodyText: string, status: number): Promise<ActionableError> {
  return generateViaClaude(makeFetch(bodyText, status), 'p', 'claude-x', 'key', { timeoutMs: 5000 })
    .then(() => { throw new Error('expected generateViaClaude to throw'); })
    .catch((e: unknown) => e as ActionableError);
}

describe('generateViaClaude — quota-exhaustion error mapping (t/3020)', () => {
  it('maps a 400 invalid_request_error usage-limit body to quota-specific Resolve steps, naming the reset date', async () => {
    const err = await callFor(QUOTA_BODY, 400);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.problem).toContain('Monthly API usage limit reached');
    expect(err.problem).toContain('2026-09-01 at 00:00 UTC'); // reset date extracted from the message
    const steps = err.nextSteps.join(' ');
    expect(steps).toContain('2026-09-01 at 00:00 UTC');       // "wait until <date>" names the date
    expect(steps).toContain('console.anthropic.com');         // upgrade path
    expect(steps.toLowerCase()).toContain('gemini');          // switch backend
    expect(steps).not.toContain('Check your API key');        // NOT the misleading generic step
  });

  it('maps the REAL nested Anthropic 400 envelope (error.type=invalid_request_error) to the same quota steps (t/3028)', async () => {
    const err = await callFor(QUOTA_BODY_NESTED, 400);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.problem).toContain('Monthly API usage limit reached');
    expect(err.problem).toContain('2026-09-01 at 00:00 UTC'); // reset date extracted from the nested message
    const steps = err.nextSteps.join(' ');
    expect(steps).toContain('2026-09-01 at 00:00 UTC');
    expect(steps).not.toContain('Check your API key');        // detection fires on the nested wire format too
    expect(steps).not.toContain('Verify the model ID');
  });

  it('keeps the generic Resolve steps for a non-quota 400 (branch is narrow)', async () => {
    const err = await callFor(JSON.stringify({ type: 'invalid_request_error', message: 'unknown model xyz' }), 400);
    expect(err).toBeInstanceOf(ActionableError);
    expect(err.nextSteps).toContain('Check your API key');
    expect(err.problem).not.toContain('Monthly API usage limit');
  });

  it('falls back to a generic date phrase when the usage-limit body has no parseable reset date', async () => {
    const err = await callFor(JSON.stringify({ type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' }), 400);
    expect(err.problem).toContain('Monthly API usage limit reached');
    expect(err.problem).toContain('the date shown in the error message');
  });
});
