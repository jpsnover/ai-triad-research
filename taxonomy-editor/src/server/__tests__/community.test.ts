// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';
// t/2032: import the REAL stripSensitiveKeys. The prior test defined an inline
// replica, so its "handles arrays" case exercised the replica's logic — not the
// production function — and could never have caught the array-branch bypass this
// ticket fixes. Testing the real export also runs the real sanitizeUserText.
import { stripSensitiveKeys } from '../community/community';

describe('community sanitization', () => {
  it('strips top-level sensitive keys', () => {
    const input = {
      id: 'test-123',
      title: 'My debate',
      api_key: 'should-be-removed',
      flight_recorder: { events: [] },
      debug: { trace: true },
      _internal: { meta: 'stuff' },
    };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    expect(result.id).toBe('test-123');
    expect(result.title).toBe('My debate');
    expect(result).not.toHaveProperty('api_key');
    expect(result).not.toHaveProperty('flight_recorder');
    expect(result).not.toHaveProperty('debug');
    expect(result).not.toHaveProperty('_internal');
  });

  it('strips nested sensitive keys recursively', () => {
    const input = {
      id: 'test-123',
      config: {
        apiKey: 'nested-key',
        model: 'gemini-2.5-flash',
        auth: {
          token: 'bearer-token',
          endpoint: 'https://api.example.com',
        },
      },
    };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    expect(result.id).toBe('test-123');
    const config = result.config as Record<string, unknown>;
    expect(config).not.toHaveProperty('apiKey');
    expect(config.model).toBe('gemini-2.5-flash');
    const auth = config.auth as Record<string, unknown>;
    expect(auth).not.toHaveProperty('token');
    expect(auth.endpoint).toBe('https://api.example.com');
  });

  it('strips values that look like API keys by prefix', () => {
    const input = {
      id: 'test-123',
      someField: 'sk-proj-abc123def456',
      anotherField: 'AIzaSyAbc123',
      normalField: 'just a normal string',
      groqKey: 'gsk_abc123',
    };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    expect(result.id).toBe('test-123');
    expect(result).not.toHaveProperty('someField');
    expect(result).not.toHaveProperty('anotherField');
    expect(result.normalField).toBe('just a normal string');
    expect(result).not.toHaveProperty('groqKey');
  });

  it('handles arrays-of-objects correctly', () => {
    const input = {
      transcript: [
        { speaker: 'user', content: 'Hello', apiKey: 'leaked' },
        { speaker: 'bot', content: 'Hi', password: 'secret123' },
      ],
    };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    const transcript = result.transcript as Record<string, unknown>[];
    expect(transcript).toHaveLength(2);
    expect(transcript[0]).not.toHaveProperty('apiKey');
    expect(transcript[0].speaker).toBe('user');
    expect(transcript[1]).not.toHaveProperty('password');
    expect(transcript[1].speaker).toBe('bot');
  });

  // t/2032 — array-of-STRINGS elements must be sanitized, not passed verbatim.
  // The prior array branch (`obj.map(stripSensitiveKeys)`) returned string
  // elements unchanged: stored XSS + secret leak into public community storage.
  it('sanitizes executable tags in array-of-strings elements', () => {
    const input = { tags: ['<script>alert(1)</script>', 'ok'] };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    const tags = result.tags as string[];
    expect(tags).toHaveLength(2);
    expect(tags[0]).not.toContain('<script'); // executable tag neutralized
    expect(tags[1]).toBe('ok');               // legit element untouched
  });

  it('redacts secret-prefixed array-of-strings elements to empty string', () => {
    const input = { keys: ['sk-LEAKED', 'AIzaLEAKED', 'gsk_LEAKED', 'normal'] };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    const keys = result.keys as string[];
    // Array shape preserved (positional), secret values gone (redacted to '').
    expect(keys).toHaveLength(4);
    expect(keys[0]).toBe('');
    expect(keys[1]).toBe('');
    expect(keys[2]).toBe('');
    expect(keys[3]).toBe('normal');
  });

  it('sanitizes strings nested in arrays-within-arrays', () => {
    const input = { nested: [['<iframe src=x>', 'sk-DEEP']] };
    const result = stripSensitiveKeys(input) as Record<string, unknown>;
    const inner = (result.nested as string[][])[0];
    expect(inner[0]).not.toContain('<iframe');
    expect(inner[1]).toBe(''); // secret redacted at any array depth
  });

  it('preserves null and primitive values', () => {
    expect(stripSensitiveKeys(null)).toBeNull();
    expect(stripSensitiveKeys('hello')).toBe('hello');
    expect(stripSensitiveKeys(42)).toBe(42);
    expect(stripSensitiveKeys(true)).toBe(true);
  });
});
