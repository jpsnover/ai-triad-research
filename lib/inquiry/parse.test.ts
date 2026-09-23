// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { parseInquiryResult } from './parse.js';
import { INQUIRY_SCHEMA_VERSION } from './schema.js';
import { ActionableError } from '../debate/errors.js';
import { makeValidResult } from './schema.test.js';
import * as barrel from './index.js';

describe('lib/inquiry barrel (index.ts) — the contract surface five consumers import', () => {
  it('re-exports the parser, version, and the four named schemas', () => {
    expect(typeof barrel.parseInquiryResult).toBe('function');
    expect(barrel.INQUIRY_SCHEMA_VERSION).toBe(INQUIRY_SCHEMA_VERSION);
    expect(barrel.InquiryRequestSchema).toBeTruthy();
    expect(barrel.InquiryResultSchema).toBeTruthy();
    expect(barrel.TrustStateSchema).toBeTruthy();
    expect(barrel.GroundingEnvelopeSchema).toBeTruthy();
  });
});

describe('parseInquiryResult — version policy (ADR §3, t/3574)', () => {
  it('same major: returns a valid result', () => {
    const out = parseInquiryResult(makeValidResult());
    expect(out.request.question).toBe('What counts as an AI harm?');
    expect(out.schemaVersion).toBe(INQUIRY_SCHEMA_VERSION);
  });

  it('same major: TOLERANT read — an unknown field survives the round-trip (not stripped)', () => {
    const raw = { ...makeValidResult(), aFieldFromAFutureMinor: { note: 'keep me' } };
    const out = parseInquiryResult(raw) as Record<string, unknown>;
    expect(out.aFieldFromAFutureMinor).toEqual({ note: 'keep me' });
  });

  it('newer major: REFUSES loudly with ActionableError, does not render', () => {
    const raw = { ...makeValidResult(), schemaVersion: INQUIRY_SCHEMA_VERSION + 1 };
    let thrown: unknown;
    try {
      parseInquiryResult(raw);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionableError);
    expect((thrown as ActionableError).problem).toMatch(/newer than this build/i);
  });

  it('older version: routes to the migrate seam, which refuses loudly (no migration in v1)', () => {
    const raw = { ...makeValidResult(), schemaVersion: INQUIRY_SCHEMA_VERSION - 1 };
    expect(() => parseInquiryResult(raw)).toThrow(ActionableError);
  });

  it('malformed same-major payload: refused with ActionableError carrying the zod issues', () => {
    const bad = makeValidResult();
    delete (bad as Record<string, unknown>).derivation; // drop a required field
    let thrown: unknown;
    try {
      parseInquiryResult(bad);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ActionableError);
    expect((thrown as ActionableError).problem).toMatch(/failed schema validation/i);
  });

  it('missing schemaVersion is refused (a result must carry a version)', () => {
    const noVersion = makeValidResult();
    delete (noVersion as Record<string, unknown>).schemaVersion;
    expect(() => parseInquiryResult(noVersion)).toThrow(ActionableError);
  });

  it('mandatory TrustState.reason is enforced through the parser', () => {
    const bad = makeValidResult() as Record<string, unknown>;
    (bad.calibration as Array<Record<string, unknown>>)[0].trust = { verdict: 'censored' }; // no reason
    expect(() => parseInquiryResult(bad)).toThrow(ActionableError);
  });
});
