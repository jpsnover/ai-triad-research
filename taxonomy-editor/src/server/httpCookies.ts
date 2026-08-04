// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2019: the request Cookie-header parser, extracted from server.ts + loginPage.ts
// (which each held a pure-mirror copy — server.ts can't be imported without booting
// the HTTP server, so the helper was duplicated). One import-safe home means one
// place to fix + test, and CodeQL's two js/remote-property-injection findings collapse
// to a single safe parse.

import type http from 'http';

/**
 * Parse a request's `Cookie` header into a name→value Map.
 *
 * Prototype-pollution-safe by construction (t/2019, js/remote-property-injection): a
 * `Map` holds cookie NAMES as ordinary data keys, so `map.set(name, value)` is NOT a
 * property-injection sink — a user-controlled `__proto__`/`constructor`/`prototype`
 * cookie name can never reach `Object.prototype` the way a dynamic `obj[name] = value`
 * write can. This is the canonical remediation (matches Server AI's t/2021); a Set/denylist
 * guard on a plain object does not clear the finding (CodeQL doesn't model the guard).
 * Values keep any `=` they contain (`rest.join('=')`).
 */
export function parseCookies(req: http.IncomingMessage): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies.set(key, rest.join('='));
  }
  return cookies;
}
