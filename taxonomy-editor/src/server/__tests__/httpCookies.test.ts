// @vitest-environment node

/**
 * t/2019 — parseCookies (extracted from server.ts + loginPage.ts) is prototype-
 * pollution-safe by construction: it returns a Map, so a user-controlled cookie name
 * of __proto__ / constructor / prototype is stored as a plain Map entry (Map keys are
 * data, not object properties) and can never reach Object.prototype
 * (js/remote-property-injection). This is the canonical remediation (matches t/2021).
 */

import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'http';
import { parseCookies } from '../httpCookies.js';

const reqWith = (cookie?: string): IncomingMessage => ({ headers: { cookie } } as unknown as IncomingMessage);

describe('parseCookies (t/2019 — prototype-pollution-safe, Map-based)', () => {
  it('parses normal cookies into a name→value Map', () => {
    const m = parseCookies(reqWith('a=1; b=two; auth_anonymous=1'));
    expect(m.get('a')).toBe('1');
    expect(m.get('b')).toBe('two');
    expect(m.get('auth_anonymous')).toBe('1');
    expect(m.size).toBe(3);
  });

  it('keeps = inside a value (rest.join)', () => {
    expect(parseCookies(reqWith('token=ab=cd=ef')).get('token')).toBe('ab=cd=ef');
  });

  it('returns an empty Map when there is no Cookie header', () => {
    expect(parseCookies(reqWith(undefined)).size).toBe(0);
  });

  // A Map holds names as data keys — a pollution-key cookie name is a normal Map entry.
  it.each(['__proto__', 'constructor', 'prototype'])('stores "%s" as a Map entry (never on a prototype)', (bad) => {
    const m = parseCookies(reqWith(`${bad}=polluted; real=ok`));
    expect(m.get('real')).toBe('ok');
    expect(m.get(bad)).toBe('polluted');
  });

  it('a __proto__ cookie does not pollute Object.prototype', () => {
    parseCookies(reqWith('__proto__=polluted; a=1'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
