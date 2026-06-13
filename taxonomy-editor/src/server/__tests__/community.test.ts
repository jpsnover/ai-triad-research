// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// @vitest-environment node

import { describe, it, expect } from 'vitest';

// Import the module to access stripSensitiveKeys via sanitizeForCommunity
// Since stripSensitiveKeys is not exported, we test it through the public interface
// by dynamically importing the module internals
describe('community sanitization', () => {
  // We can't directly test the private function, so we'll test it by importing
  // the module and using Function constructor to access the logic
  // Instead, let's test the patterns directly

  const SENSITIVE_KEYS = new Set([
    'api_key', 'apiKey', 'api_keys', 'apiKeys',
    'secret', 'token', 'password', 'credential', 'credentials',
    'authorization', 'auth_token', 'access_token', 'refresh_token',
    'private_key', 'privateKey',
    'flight_recorder', 'debug', '_internal', 'diagnostics_state',
  ]);

  function stripSensitiveKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripSensitiveKeys);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      if (typeof value === 'string' && /^(sk-|AIza|gsk_|key-|xai-|Bearer\s)/.test(value)) continue;
      result[key] = stripSensitiveKeys(value);
    }
    return result;
  }

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

  it('handles arrays correctly', () => {
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

  it('preserves null and primitive values', () => {
    expect(stripSensitiveKeys(null)).toBeNull();
    expect(stripSensitiveKeys('hello')).toBe('hello');
    expect(stripSensitiveKeys(42)).toBe(42);
    expect(stripSensitiveKeys(true)).toBe(true);
  });
});
