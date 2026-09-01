// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3206 (t/3165 storm-replay canary) — the two control routes for the storm-window loop-lag
// sampler (canaryLoopSampler.ts, authored by Diagnostics e/130). The DevOps driver calls:
//   start → drive the storm (anon free-tier debates) → ~50ms settle → report → assert gate.pass.
//
// Gated by the per-revision env flag CANARY_LOOP_SAMPLER (default OFF):
//   - flag OFF → both routes 404 (measurement surface invisible in normal prod), AND the
//     /internal/canary/* anon-exemption (publicPaths.ts) does not exist → double-closed.
//   - flag ON (staging canary rev only) → anon-reachable (publicPaths exemption is flag-gated too),
//     so the headless driver POSTs unauthenticated. The surface is measurement-only — it
//     starts/reads/disables a perf_hooks histogram; no data read, no user-state mutation, no compute.
//
// SERIAL RUNS ONLY: the sampler is a module-level singleton, so a concurrent second `start` resets
// the first's window. The staging canary drives one run at a time; don't fire concurrent runs.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error } from '../httpKit.js';
import { isCanaryLoopSamplerEnabled } from '../config.js';
import { startCanaryLoopSampler, reportCanaryLoopSampler } from '../canaryLoopSampler.js';

export function registerCanaryRoutes(r: Router, _ctx: ServerCtx): void {
  const { post } = r;

  post('/internal/canary/loop-sampler/start', (_req, res) => {
    if (!isCanaryLoopSamplerEnabled()) { error(res, 'Not found', 404); return; }
    startCanaryLoopSampler();
    json(res, { started: true });
  });

  post('/internal/canary/loop-sampler/report', (_req, res) => {
    if (!isCanaryLoopSamplerEnabled()) { error(res, 'Not found', 404); return; }
    try {
      json(res, reportCanaryLoopSampler());
    } catch (err) {
      // report-without-start / double-report → the sampler throws 'not started'. That's a caller
      // sequencing error (409), not a server fault (500). No FR record: it's an expected driver
      // condition on a flag-gated staging-only surface. telemetry — silent by design.
      const msg = (err as Error).message;
      if (/not started/.test(msg)) { error(res, 'sampler not started', 409); return; }
      error(res, msg, 500, err);
    }
  });
}
