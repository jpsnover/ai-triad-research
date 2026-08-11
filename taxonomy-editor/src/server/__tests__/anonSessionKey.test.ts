// @vitest-environment node
// t/2465 — resolveAnonSessionKey: anonymous analytics events keyed by
// truncated anon_session_id cookie instead of the _anonymous bucket.

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import { resolveAnonSessionKey } from '../routes/session.js';

const reqWith = (cookie?: string): IncomingMessage =>
  ({ headers: { cookie } } as unknown as IncomingMessage);

describe('resolveAnonSessionKey (t/2465)', () => {
  it('returns anon:<12-char prefix> when anon_session_id cookie is present', () => {
    const key = resolveAnonSessionKey(reqWith('anon_session_id=abcdefghijklmnopqrstuvwxyz'));
    expect(key).toBe('anon:abcdefghijkl');
  });

  it('truncates to exactly 12 chars for values longer than 12', () => {
    const longVal = 'a'.repeat(50);
    expect(resolveAnonSessionKey(reqWith(`anon_session_id=${longVal}`))).toBe('anon:aaaaaaaaaaaa');
  });

  it('returns _anonymous when no anon_session_id cookie is present', () => {
    expect(resolveAnonSessionKey(reqWith(undefined))).toBe('_anonymous');
    expect(resolveAnonSessionKey(reqWith('other=cookie'))).toBe('_anonymous');
  });
});
