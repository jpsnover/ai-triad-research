// @vitest-environment node
//
// t/2494 (t/2490 Gap 2, server half) — the chat-stream ai.request flight-recorder
// event gains chatSessionId, linkedDebateId, and auth_user_type so an anon-chat-403
// dump is self-explanatory. These cover the two derivation helpers: caller-class
// from the ALS user context, and the client-id bound (absent-field tolerance +
// oversize guard). boundedId returning undefined is how absent fields drop out of
// the serialized event (JSON.stringify omits undefined).

import { describe, it, expect } from 'vitest';
import { authUserType, boundedId } from '../routes/chat.js';
import * as userContext from '../security/userContext.js';

const ctx = (over: Partial<Parameters<typeof userContext.runWithUser>[0]>) => ({
  principalName: 'alice', idp: 'github', storageUserId: 'alice', isAnonymous: false, ...over,
});

describe('t/2494 — chat-stream ai.request observability fields', () => {
  describe('authUserType (caller class from ALS context)', () => {
    it('returns "local" when there is no context', () => {
      expect(authUserType()).toBe('local');
    });
    it('returns "local" for the _local single-user principal', () => {
      const r = userContext.runWithUser(ctx({ principalName: '_local' }), authUserType);
      expect(r).toBe('local');
    });
    it('returns "anonymous" for a cookie-only anonymous caller', () => {
      const r = userContext.runWithUser(ctx({ principalName: 'anon-abc', isAnonymous: true }), authUserType);
      expect(r).toBe('anonymous');
    });
    it('returns "authenticated" for a signed-in principal', () => {
      const r = userContext.runWithUser(ctx({}), authUserType);
      expect(r).toBe('authenticated');
    });
  });

  describe('boundedId (client linkage id, safe for logging)', () => {
    it('passes a normal id through unchanged', () => {
      expect(boundedId('chat-123')).toBe('chat-123');
    });
    it('returns undefined for absent / empty / non-string (older-client tolerance)', () => {
      expect(boundedId(undefined)).toBeUndefined();
      expect(boundedId('')).toBeUndefined();
      expect(boundedId(42)).toBeUndefined();
      expect(boundedId(null)).toBeUndefined();
      expect(boundedId({})).toBeUndefined();
    });
    it('caps an oversize value at 128 chars (recorder-bloat guard)', () => {
      const big = 'x'.repeat(5000);
      expect(boundedId(big)).toHaveLength(128);
    });
    it('an undefined field is omitted from the serialized event data', () => {
      // Mirrors how the event is built: undefined values drop out of the JSON.
      const data = { model: 'm', chatSessionId: boundedId(undefined), linkedDebateId: boundedId('d-1') };
      expect(JSON.parse(JSON.stringify(data))).toEqual({ model: 'm', linkedDebateId: 'd-1' });
    });
  });
});
