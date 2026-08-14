// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { stripCodeFences } from '../debate/helpers.js';

const VALID_ESSAY = JSON.stringify({
  headline: 'AI Audits Are Overdue',
  subtitle: 'The safety case',
  body_markdown: 'The essay body text here.',
  word_count: 5,
  pitch_email: 'Dear editor,',
  stance: 'extend',
});

describe('essay parse — fence stripping (t/2618)', () => {
  it('parses clean JSON unchanged', () => {
    const result = JSON.parse(stripCodeFences(VALID_ESSAY));
    expect(result.headline).toBe('AI Audits Are Overdue');
    expect(result.pitch_email).toBe('Dear editor,');
  });

  it('strips ```json fence and parses structured fields', () => {
    const fenced = '```json\n' + VALID_ESSAY + '\n```';
    const result = JSON.parse(stripCodeFences(fenced));
    expect(result.headline).toBe('AI Audits Are Overdue');
    expect(result.subtitle).toBe('The safety case');
    expect(result.pitch_email).toBe('Dear editor,');
  });

  it('strips bare ``` fence and parses structured fields', () => {
    const fenced = '```\n' + VALID_ESSAY + '\n```';
    const result = JSON.parse(stripCodeFences(fenced));
    expect(result.headline).toBe('AI Audits Are Overdue');
  });

  it('produces byte-identical output on repeated calls', () => {
    const fenced = '```json\n' + VALID_ESSAY + '\n```';
    expect(stripCodeFences(fenced)).toBe(stripCodeFences(fenced));
  });
});
