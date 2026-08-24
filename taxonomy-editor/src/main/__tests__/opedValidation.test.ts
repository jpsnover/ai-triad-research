// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression coverage for the create-oped-set guard (t/2908 / t/2910). The handler is
// electron-coupled, so the validation lives in a pure helper that this test exercises
// directly. The load-bearing case is url-only: FromUrl mode sends an empty topic, and
// the pre-t/2908 guard rejected it, blocking all From-web-page creates.

import { describe, it, expect } from 'vitest';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { validateCreateOpEdPayload } from '../ipc/opedValidation.js';

const voices = ['accelerationist'];

describe('validateCreateOpEdPayload (t/2908/t/2910)', () => {
  it('accepts a topic-only payload', () => {
    expect(validateCreateOpEdPayload({ topic: 'Mandatory audits', voices })).toBeNull();
  });

  it('accepts a url-only payload (empty topic — the FromUrl regression case)', () => {
    expect(validateCreateOpEdPayload({ topic: '', url: 'https://example.com/piece', voices })).toBeNull();
  });

  it('rejects when both topic and url are blank', () => {
    const err = validateCreateOpEdPayload({ topic: '   ', url: '', voices });
    expect(err).toBeInstanceOf(ActionableError);
  });

  it('rejects when no voices are selected even with a topic', () => {
    expect(validateCreateOpEdPayload({ topic: 'Mandatory audits', voices: [] })).toBeInstanceOf(ActionableError);
  });

  it('rejects a whitespace-only topic with no url', () => {
    expect(validateCreateOpEdPayload({ topic: '   ', voices })).toBeInstanceOf(ActionableError);
  });

  it('treats a whitespace-only url as no source', () => {
    expect(validateCreateOpEdPayload({ topic: '', url: '   ', voices })).toBeInstanceOf(ActionableError);
  });

  it('returns an actionable error with next steps', () => {
    const err = validateCreateOpEdPayload({ voices: [] });
    expect(err?.nextSteps.length).toBeGreaterThan(0);
    expect(err?.problem).toMatch(/topic or a web-page URL/i);
  });
});
