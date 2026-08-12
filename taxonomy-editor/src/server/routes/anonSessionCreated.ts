// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2493: companion "session created at" marker for the anonymous session.
//
// `anon_session_id` is an opaque crypto.randomUUID() with no embedded time
// (security/accessControl.ts), so nothing records when an anon session began.
// This module owns a small HttpOnly companion cookie, `anon_session_created`,
// carrying the mint (or first-seen) instant as epoch-ms, so /api/auth/me can
// expose `session_created_at` for the flight-recorder auth snapshot
// (t/2490 Gap 1). Kept import-safe (no server.ts import) and shared by the two
// mint sites (server.ts) and the backfill/read in /api/auth/me (session.ts).

import type { IncomingMessage } from 'http';
import { parseCookies } from '../httpCookies.js';
import { resolveAnonSessionId, anonymousSessionCookies } from '../security/accessControl.js';

export const ANON_SESSION_CREATED_COOKIE = 'anon_session_created';

// Sane floor: nothing legitimate predates the project's existence, so a client
// cookie earlier than this is forged/garbage and is treated as absent.
// 2025-01-01T00:00:00Z — comfortably before the first anon session could exist.
const ANON_SESSION_EPOCH_FLOOR_MS = 1_735_689_600_000;

// Tolerate small forward clock skew before rejecting a "future" cookie.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// Mirror of anonymousSessionCookies' Secure gating (security/accessControl.ts) —
// replicated here (not imported) to avoid a cross-scope edit; SameSite / Path /
// HttpOnly / Max-Age are kept in parity with the id cookie so the two travel
// together identically.
function secureSuffix(): string {
  return process.env.NODE_ENV === 'production' || process.env.ALLOWED_ORIGINS ? '; Secure' : '';
}

/** Build the Set-Cookie string for the created marker (epoch-ms), 1yr persistence
 *  to match the id cookie. HttpOnly — read server-side only, echoed to the client
 *  as an ISO string via /api/auth/me, never as the raw cookie value. */
export function anonSessionCreatedCookie(epochMs: number): string {
  return `${ANON_SESSION_CREATED_COOKIE}=${epochMs}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureSuffix()}`;
}

/**
 * Mint the anon-session cookies (id + auth flag, via accessControl) and append the
 * `anon_session_created` marker WHENEVER a fresh UUID is minted. On fresh mint the
 * marker is written unconditionally (= now) so a new session can never inherit a
 * stale created cookie left by an independently-cleared id (t/2493 cond. 2). A
 * reused id leaves any existing created cookie untouched. `nowMs` is injectable
 * for deterministic tests.
 */
export function anonSessionCookiesWithCreated(req: IncomingMessage, nowMs: number = Date.now()): string[] {
  const existingId = parseCookies(req).get('anon_session_id');
  const id = resolveAnonSessionId(existingId); // t/2464: reuse-not-rotate
  const cookies = anonymousSessionCookies(id);
  if (id !== existingId) cookies.push(anonSessionCreatedCookie(nowMs)); // t/2493: fresh mint
  return cookies;
}

/**
 * Read the client-supplied created cookie as a trusted-iff-sane epoch-ms.
 *
 * The cookie round-trips through the client, so a UA can forge it (t/2493 cond. 1).
 * Returns the ms only when it parses as an integer within [floor, now + skew];
 * otherwise null, signalling the caller to re-backfill with `now` and overwrite.
 * The raw value is never echoed into a response.
 */
export function readValidCreatedMs(req: IncomingMessage, nowMs: number): number | null {
  const raw = parseCookies(req).get(ANON_SESSION_CREATED_COOKIE);
  if (raw === undefined) return null;
  if (!/^\d{1,15}$/.test(raw)) return null;              // integer epoch-ms only
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms)) return null;
  if (ms < ANON_SESSION_EPOCH_FLOOR_MS) return null;     // predates product → forged
  if (ms > nowMs + CLOCK_SKEW_MS) return null;           // future → forged
  return ms;
}
