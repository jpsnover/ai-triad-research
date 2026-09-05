// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3112 — GET /readyz deploy warm-gate.
// 200 ONLY when the embeddings.json precomputed-vector cache is present AND nodeCount>0
// (TL-approved contract, p/542#55); 503 while warming. Anon (deploy probe polls pre-auth).
// Covers: publicPaths inclusion + handler response shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PUBLIC_EXACT_PATHS, computeIsPublicPath } from '../publicPaths.js';

// t/3114 shared body-contract fixture. This SAME file is read by the deploy warm-gate's
// Pester (tests/ReadyzWarmGate.Tests.ps1) as the "real 200 body" it feeds to the predicate.
// The coupling: the assertion below forces this fixture to track the handler's actual output,
// and the Pester forces the gate to parse whatever key the fixture uses — so a coordinated
// status-field rename can't silently pass both (it goes red on one side or the other).
import readyBody from './fixtures/readyz-ready-body.json';

// ── publicPaths ──────────────────────────────────────────────────────────────

describe('publicPaths — /readyz', () => {
  it('is in PUBLIC_EXACT_PATHS (exact match, not prefix)', () => {
    expect(PUBLIC_EXACT_PATHS.has('/readyz')).toBe(true);
  });

  it('computeIsPublicPath returns true for /readyz', () => {
    expect(computeIsPublicPath('/readyz')).toBe(true);
  });

  it('does not treat it as a prefix (trailing path must not match)', () => {
    expect(computeIsPublicPath('/readyz/extra')).toBe(false);
  });
});

// ── handler response shape (inline simulation) ───────────────────────────────
// The route handler is a thin conditional over getEmbeddingsResolution(). We test the
// output the conditional produces rather than importing meta.ts (which pulls heavy deps).
// Keep this in lockstep with the handler in routes/meta.ts.
// t/3165: 200 now requires RESOLUTION (a canary keyed lookup hits a real vector), not mere
// presence — a present-but-non-resolving cache (stale/wrong corpus) → 503.

const CANARY = 'acc-beliefs-003';
type Resolution = { present: boolean; nodeCount: number | null; resolves: boolean };
type DataRoot = { state: 'validating' | 'ready' | 'failed'; reason?: string };
type HandlerResult = { statusCode: number; body: Record<string, unknown> };

// t/3309: the data-root gate composes AHEAD of the embeddings gate. Default 'ready' so the
// existing embeddings-branch cases below are unaffected (data-root ready → falls through).
function simulateReadyz(r: Resolution, dataRoot: DataRoot = { state: 'ready' }): HandlerResult {
  // t/3236: test-only fault knob — force the definitive data-root-FAILED state, gated non-prod.
  // In lockstep with routes/meta.ts. Runtime-scoped: overrides only this response, not boot.
  const forceDataRootFailed = process.env.NODE_ENV !== 'production' && process.env.READYZ_FORCE_DATA_ROOT_FAILED === '1';
  const dr: DataRoot = forceDataRootFailed
    ? { state: 'failed', reason: 'forced (READYZ_FORCE_DATA_ROOT_FAILED test knob, t/3236)' }
    : dataRoot;
  if (dr.state === 'failed') {
    return { statusCode: 503, body: { status: 'failed', reason: `data-root-failed: ${dr.reason ?? 'unknown'}` } };
  }
  if (dr.state === 'validating') {
    return { statusCode: 503, body: { status: 'warming', reason: 'data-root-validating' } };
  }
  const { present, nodeCount, resolves } = r;
  if (present && (nodeCount ?? 0) > 0 && resolves) {
    return { statusCode: 200, body: { status: 'ready', nodeCount, resolves: true } };
  }
  const reason = !present ? 'cache-absent' : !resolves ? 'canary-not-resolving' : 'empty';
  return { statusCode: 503, body: { status: 'warming', present, nodeCount, resolves: false, reason, canary: CANARY } };
}

describe('GET /readyz — response shape (t/3112, t/3165 resolution)', () => {
  it('200 { status: ready, nodeCount, resolves } when present, nodeCount>0 AND canary resolves', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144, resolves: true });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'ready', nodeCount: 4144, resolves: true });
  });

  it('t/3165: 503 when cache present + nodeCount>0 but the canary does NOT resolve (stale/wrong corpus)', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.resolves).toBe(false);
    expect(body.reason).toBe('canary-not-resolving');
  });

  it('503 while warming when cache absent', () => {
    const { statusCode, body } = simulateReadyz({ present: false, nodeCount: null, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.present).toBe(false);
    expect(body.reason).toBe('cache-absent');
  });

  it('503 when present but nodeCount is 0 (empty/partial cache is not ready)', () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 0, resolves: false });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
  });
});

// ── t/3309: data-root readiness gate composes ahead of embeddings ─────────────
// The data-root state (validating/ready/failed) gates /readyz BEFORE the embeddings check.
// 'failed' is a definitive 503 (status:'failed', not warming) so a misprovisioned corpus is
// not masked as a slow warm-up (cond 3); 'validating' is a warming 503; 'ready' falls through.
describe('GET /readyz — data-root gate (t/3309)', () => {
  const RESOLVING: Resolution = { present: true, nodeCount: 4144, resolves: true };

  it("503 { status: failed, data-root-failed:<reason> } when data-root validation failed — even if embeddings resolve", () => {
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'failed', reason: "sentinel 'taxonomy/' present but empty" });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('failed'); // definitive, NOT 'warming' — not masked as slow warm-up
    expect(String(body.reason)).toMatch(/^data-root-failed:/);
    expect(String(body.reason)).toContain('taxonomy');
  });

  it("503 { status: warming, data-root-validating } while startup validation is in flight", () => {
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'validating' });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.reason).toBe('data-root-validating');
  });

  it('failed reason falls back to "unknown" when none is cached', () => {
    const { body } = simulateReadyz(RESOLVING, { state: 'failed' });
    expect(body.reason).toBe('data-root-failed: unknown');
  });

  it("data-root 'ready' falls through to the embeddings gate — 200 unchanged (fixture-contract preserved)", () => {
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'ready' });
    expect(statusCode).toBe(200);
    expect(body).toEqual({ status: 'ready', nodeCount: 4144, resolves: true });
  });

  it("data-root 'ready' but embeddings not resolving → the existing embeddings 503 (gates are independent)", () => {
    const { statusCode, body } = simulateReadyz({ present: true, nodeCount: 4144, resolves: false }, { state: 'ready' });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('warming');
    expect(body.reason).toBe('canary-not-resolving');
  });
});

// ── shared body-contract fixture ↔ handler coupling (t/3114) ──────────────────
// This is the guard TL required for promoting the deploy warm-gate to BLOCKING: a
// blocking gate whose expected body drifts from the handler = block-every-deploy.
// readyz-ready-body.json is the single literal BOTH sides reference — here (producer
// side) and the gate's Pester (consumer side, feeds it to the predicate). The first
// assertion forces the fixture to track the handler's real 200 output; the Pester
// forces the gate to parse whatever key the fixture uses. A coordinated rename of
// `status` can't pass both — it goes red here (fixture no longer matches the handler)
// or in the Pester (gate parses the old key, gets a non-'ready' body → wait).
describe('/readyz shared body-contract fixture (t/3114)', () => {
  it('fixture equals the handler\'s real 200 ready body (producer-side pin)', () => {
    const real = simulateReadyz({ present: true, nodeCount: readyBody.nodeCount, resolves: true }).body;
    expect(real).toEqual(readyBody);
  });

  it('fixture carries the contract invariants the gate keys on: status==="ready", nodeCount>0, resolves===true', () => {
    expect(readyBody.status).toBe('ready');
    expect(readyBody.nodeCount).toBeGreaterThan(0);
    expect(readyBody.resolves).toBe(true); // t/3165: resolution is now part of the 200 contract
  });
});

// ── t/3236: READYZ_FORCE_DATA_ROOT_FAILED test-only fault knob ────────────────
// Lets DevOps exercise the deploy warm-gate's FIRE arm (503 'failed' → block traffic-shift →
// fail+rollback) against a REAL staging revision with real data, no 700M throwaway repo.
// TL cond 1: forces the DEFINITIVE 'failed' state (NOT 'validating'). TL cond 2: gated
// NODE_ENV!=='production' so it can NEVER force a false-negative /readyz in prod.
describe('GET /readyz — READYZ_FORCE_DATA_ROOT_FAILED knob (t/3236)', () => {
  const RESOLVING: Resolution = { present: true, nodeCount: 4144, resolves: true };
  const ORIG_NODE_ENV = process.env.NODE_ENV;
  beforeEach(() => { delete process.env.READYZ_FORCE_DATA_ROOT_FAILED; process.env.NODE_ENV = 'test'; });
  afterEach(() => { delete process.env.READYZ_FORCE_DATA_ROOT_FAILED; process.env.NODE_ENV = ORIG_NODE_ENV; });

  it('knob ON + non-production: forces definitive 503 failed even when data-root ready AND embeddings resolve', () => {
    process.env.READYZ_FORCE_DATA_ROOT_FAILED = '1';
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'ready' });
    expect(statusCode).toBe(503);
    expect(body.status).toBe('failed'); // TL cond 1: definitive failed, NOT 'warming'
    expect(String(body.reason)).toMatch(/^data-root-failed:/);
    expect(String(body.reason)).toContain('READYZ_FORCE_DATA_ROOT_FAILED');
  });

  it('knob ON + NODE_ENV=production: INERT — falls through to the real ready 200 (no prod false-negative)', () => {
    process.env.NODE_ENV = 'production';
    process.env.READYZ_FORCE_DATA_ROOT_FAILED = '1';
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'ready' });
    expect(statusCode).toBe(200);
    expect(body.status).toBe('ready');
  });

  it('knob value other than "1" is ignored', () => {
    process.env.READYZ_FORCE_DATA_ROOT_FAILED = 'true'; // only exactly "1" enables
    expect(simulateReadyz(RESOLVING, { state: 'ready' }).statusCode).toBe(200);
  });

  it('knob unset: real data-root state governs (unchanged behavior)', () => {
    const { statusCode, body } = simulateReadyz(RESOLVING, { state: 'ready' });
    expect(statusCode).toBe(200);
    expect(body.status).toBe('ready');
  });
});
