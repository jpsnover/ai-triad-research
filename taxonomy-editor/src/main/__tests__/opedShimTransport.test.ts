// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Regression coverage for the FromUrl op-ed shim→handler transport (t/2928). The real incident
// was a PS ConvertTo-Json defect (invalid JSON for real article HTML) that the handler then
// silently swallowed → opaque "No result received." These test the two pure defenses directly:
// base64 round-trip of arbitrary content, and surfacing (not swallowing) a broken result line.

import { describe, it, expect } from 'vitest';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { parseShimLine, decodeB64Fields } from '../ipc/opedShimTransport.js';

// The exact shape that broke it: prose with an embedded `*"..."*` quote + a base64 data-URI.
const NASTY = '# Title\n\n*"Who is talking to your child?"*\n\nBody with a data URI ![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ) and a trailing "quote".';

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

describe('opedShimTransport — decodeB64Fields (t/2928)', () => {
  it('round-trips a base64 SourceMarkdown byte-faithfully', () => {
    const data = { SourceMarkdown: b64(NASTY), Excerpt: b64('short "excerpt"'), _b64Fields: ['SourceMarkdown', 'Excerpt'] };
    const decoded = decodeB64Fields({ ...data });
    expect(decoded.SourceMarkdown).toBe(NASTY);
    expect(decoded.Excerpt).toBe('short "excerpt"');
  });

  it('strips the _b64Fields marker so downstream never sees it', () => {
    const decoded = decodeB64Fields({ SourceMarkdown: b64('x'), _b64Fields: ['SourceMarkdown'] });
    expect('_b64Fields' in decoded).toBe(false);
  });

  it('is a no-op when _b64Fields is absent (backward-safe)', () => {
    const decoded = decodeB64Fields({ SourceMarkdown: 'already-plain', ReadableWords: 42 });
    expect(decoded.SourceMarkdown).toBe('already-plain');
    expect(decoded.ReadableWords).toBe(42);
  });

  it('leaves a non-string field named in _b64Fields untouched', () => {
    const decoded = decodeB64Fields({ SourceMarkdown: null as unknown as string, _b64Fields: ['SourceMarkdown'] });
    expect(decoded.SourceMarkdown).toBeNull();
  });
});

describe('opedShimTransport — parseShimLine (t/2928)', () => {
  it('parses a valid result line and returns its data', () => {
    const line = JSON.stringify({ type: 'result', data: { SourceMarkdown: b64(NASTY), _b64Fields: ['SourceMarkdown'] } });
    const msg = parseShimLine(line);
    expect(msg?.type).toBe('result');
  });

  it('THROWS an ActionableError on a result-looking line that fails to parse (never swallows)', () => {
    // Contains "type":"result" but a bare unescaped " prematurely ends the string — the exact defect.
    const broken = '{"type":"result","data":{"SourceMarkdown":"a bare " quote ends the string"}}';
    expect(() => parseShimLine(broken)).toThrow(ActionableError);
    try {
      parseShimLine(broken);
    } catch (e) {
      expect((e as ActionableError).problem).toMatch(/unparseable result line/i);
      expect((e as ActionableError).nextSteps.some((s) => /base64/i.test(s))).toBe(true);
    }
  });

  it('returns null (skips) a non-result line that does not parse', () => {
    expect(parseShimLine('not json at all')).toBeNull();
    expect(parseShimLine('{"type":"stage", broken')).toBeNull();
  });

  it('parses a valid stage line', () => {
    expect(parseShimLine(JSON.stringify({ type: 'stage', stage: 'fetching' }))?.type).toBe('stage');
  });
});
