// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1574 — validate KEY_PROBE_CONFIGS structure and completeness.

import { describe, it, expect } from 'vitest';
import { KEY_PROBE_CONFIGS, SUPPORTED_PROBE_BACKENDS } from '../keyProbes.js';
import type { ProbeConfig } from '../keyProbes.js';

describe('KEY_PROBE_CONFIGS (t/1574)', () => {
  it('SUPPORTED_PROBE_BACKENDS matches KEY_PROBE_CONFIGS keys', () => {
    expect(SUPPORTED_PROBE_BACKENDS).toEqual(Object.keys(KEY_PROBE_CONFIGS));
  });

  it('covers all 6 canonical backends', () => {
    expect(SUPPORTED_PROBE_BACKENDS.sort()).toEqual(
      ['claude', 'deepseek', 'gemini', 'groq', 'openai', 'zai'],
    );
  });

  it('every entry has callable url and headers', () => {
    for (const [id, cfg] of Object.entries(KEY_PROBE_CONFIGS)) {
      expect(typeof cfg.url, `${id}.url`).toBe('function');
      expect(typeof cfg.headers, `${id}.headers`).toBe('function');

      const url = cfg.url('test-key');
      expect(typeof url, `${id}.url('test-key')`).toBe('string');
      expect(url.startsWith('https://'), `${id}.url must be HTTPS`).toBe(true);

      const hdrs = cfg.headers('test-key');
      expect(typeof hdrs, `${id}.headers('test-key')`).toBe('object');
    }
  });

  it('gemini uses POST generateContent with body (not list-models)', () => {
    const cfg = KEY_PROBE_CONFIGS['gemini'] as ProbeConfig;
    expect(cfg.method).toBe('POST');
    expect(cfg.url('k')).toContain('generateContent');
    expect(cfg.url('k')).not.toContain('/models?key=');
    expect(cfg.body).toBeDefined();
    const body = cfg.body!();
    expect(body).toContain('maxOutputTokens');
  });

  it('gemini URL encodes the key', () => {
    const url = KEY_PROBE_CONFIGS['gemini'].url('key with spaces&special=chars');
    expect(url).toContain('key%20with%20spaces%26special%3Dchars');
  });

  it('non-gemini backends default to GET (no method or body)', () => {
    for (const id of ['claude', 'groq', 'openai', 'deepseek', 'zai']) {
      const cfg = KEY_PROBE_CONFIGS[id];
      expect(cfg.method, `${id} should not set method (defaults to GET)`).toBeUndefined();
      expect(cfg.body, `${id} should not have a body`).toBeUndefined();
    }
  });

  it('claude uses x-api-key header (not Bearer)', () => {
    const hdrs = KEY_PROBE_CONFIGS['claude'].headers('my-key');
    expect(hdrs['x-api-key']).toBe('my-key');
    expect(hdrs['anthropic-version']).toBe('2023-06-01');
    expect(hdrs['Authorization']).toBeUndefined();
  });

  it('Bearer-auth backends embed key in Authorization header', () => {
    for (const id of ['groq', 'openai', 'deepseek', 'zai']) {
      const hdrs = KEY_PROBE_CONFIGS[id].headers('my-key');
      expect(hdrs['Authorization'], id).toBe('Bearer my-key');
    }
  });
});
