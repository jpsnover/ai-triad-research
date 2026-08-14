// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2573 (parent epic t/2570, Op-Ed Studio spec §9): the /api/oped-sets route
// cluster — the REST *library* surface for the web build (list/load/delete),
// parallel to the debate-session set (routes/debates.ts). Backed by the
// personal oped-set store (storage/opedStore.ts, t/2572).
//
// v1 has NO create/generation route — New-OpEd is PowerShell and the web
// container can't run it (TL feasibility ruling, t/2573). The web UI surfaces a
// "create in the desktop app" affordance; generation stays Electron-only until a
// TS port is decided (separate epic-level call).
//
// Anonymous contract: opedStore returns []/null and no-ops for anonymous users
// (there is no anonymous oped tier). So GET is safe for anon (empty result) and
// DELETE is deliberately left anon-blocked by the default auth gate
// (isAnonAllowedRoute) — an anon caller has no oped-sets to delete.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { isSafeId } from '../storage/fileIO.js';
import { listOpedSets, loadOpedSet, deleteOpedSet, getOpedSetsQuotaStatus, finalizeOpedSet } from '../storage/opedStore.js';
import type { OpEdSet, OpEdMember, OpEdParams, PovKey } from '../../../../lib/oped/types.js';
import type { GenerateOpEdRequest, OpEdGeneratorDeps, OpEdProgressEvent } from '../../../../lib/oped/generate.js';
import { getStorageUserId, isAnonymousUser, getCurrentUser } from '../security/userContext.js';
import { callerTierIdentity } from '../security/accessControl.js';
import * as proxyTiers from '../ai/proxyTiers.js';
import { resolveBackend } from '../ai/aiBackends.js';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import { getProjectRoot } from '../config.js';
import { createWebOpEdAdapter } from '../ai/opedAdapter.js';
import { randomUUID } from 'crypto';
import path from 'path';

const ROUTE_ID = '/api/oped-sets/:id';

// Set-level topic cap — a short title, not an essay; rejects pathological payloads
// without rejecting legitimately long topic lines. Used by both create and rename.
const MAX_TOPIC_LEN = 2000;

// ── t/2610: op-ed generation run registry (per-replica) ───────────────────────
// Drives the per-user concurrency cap and the observational GET /api/oped-runs/:runId.
// Completion is authoritative via the durable finalized set (opedStore), NOT this map —
// a cross-replica reconnect / replica recycle recovers via the sets GET (TL Q2, t/2610#3).
// TTL-swept so an abandoned run can't leak a concurrency slot.
const MAX_CONCURRENT_OPED_RUNS = 1;          // per user, P1 (TL Q1)
const OPED_RUN_TTL_MS = 10 * 60_000;
const OPED_HEARTBEAT_MS = 15_000;

type VoiceState = 'pending' | 'complete' | 'failed' | 'cancelled';
interface OpEdRun {
  runId: string;
  userId: string;
  setId: string;
  status: 'running' | 'complete' | 'cancelled' | 'error';
  perVoice: Record<string, VoiceState>;
  startedAt: number;
}
const opedRuns = new Map<string, OpEdRun>();

function sweepOpedRuns(): void {
  const now = Date.now();
  for (const [id, run] of opedRuns) {
    if (run.status !== 'running' && now - run.startedAt > OPED_RUN_TTL_MS) opedRuns.delete(id);
  }
}
function countRunningOpedRuns(userId: string): number {
  let n = 0;
  for (const run of opedRuns.values()) if (run.userId === userId && run.status === 'running') n++;
  return n;
}

// ── create-request parsing (P1 FromTopic only) ──
interface ParsedOpEdCreate { topic: string; povs: string[]; params: OpEdParams }
function parseOpEdCreate(body: unknown): { ok: true; value: ParsedOpEdCreate } | { ok: false; status: number; message: string } {
  const b = (body ?? {}) as { topic?: unknown; params?: OpEdParams; povs?: unknown; url?: unknown; source?: unknown };
  // P1 is FromTopic only (TL) — never present a submit path the server can't run.
  if (b.url != null || b.source != null) return { ok: false, status: 400, message: 'URL/source op-eds are desktop-only in v1 — use a topic' };
  const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
  const povs = Array.isArray(b.povs) ? b.povs.filter((p): p is string => typeof p === 'string') : [];
  const params = b.params;
  if (!topic || topic.length > MAX_TOPIC_LEN) return { ok: false, status: 400, message: 'topic is required (non-empty, ≤2000 chars)' };
  if (povs.length === 0) return { ok: false, status: 400, message: 'at least one voice (pov) is required' };
  if (!params || typeof params.model !== 'string' || typeof params.wordCount !== 'number') return { ok: false, status: 400, message: 'params.model and params.wordCount are required' };
  return { ok: true, value: { topic, povs, params } };
}

/** Tier-backend entitlement (mirrors chat.ts resolveGenerationContext, t/2610#11): a free
 *  user must not invoke a premium backend via `params.model`, and the free tier's model is
 *  pinned. Returns the EFFECTIVE model to generate with (pinned for free). */
function resolveOpEdModel(params: OpEdParams): { ok: true; model: string } | { ok: false; status: number; message: string } {
  const { principalName, idp } = callerTierIdentity(getCurrentUser());
  const tier = proxyTiers.resolveTier(principalName, idp);
  const model = tier.level === 'free' ? (tier.pinnedModel ?? params.model) : params.model;
  const backend = resolveBackend(model || DEFAULT_MODEL);
  if (!proxyTiers.isBackendAllowed(tier, backend)) {
    return { ok: false, status: 403, message: `Your plan can't use the ${backend} backend — choose an allowed model` };
  }
  return { ok: true, model: model || params.model };
}

function applyEventToRun(run: OpEdRun, event: OpEdProgressEvent, completed: OpEdMember[]): void {
  if (event.type === 'voice_complete') { run.perVoice[event.pov] = 'complete'; completed.push(event.member); }
  else if (event.type === 'voice_failed') run.perVoice[event.pov] = 'failed';
  else if (event.type === 'voice_cancelled') run.perVoice[event.pov] = 'cancelled';
}

/** Drive the shared lib/oped generator, streaming each event as an SSE frame and
 *  persisting the assembled set on 'complete' (full OR partial — the core includes
 *  completed members + cancelled markers, so a cancel after 2/3 voices keeps the 2,
 *  TL gap 1). A throw before the core's own 'complete' still persists whatever finished. */
async function driveOpEdRun(
  res: import('http').ServerResponse,
  run: OpEdRun,
  request: GenerateOpEdRequest,
  writeFrame: (event: Record<string, unknown>) => void,
  heartbeat: ReturnType<typeof setInterval>,
  isClientGone: () => boolean,
): Promise<void> {
  const completed: OpEdMember[] = [];
  try {
    // 4-ups matches tsconfig.server rootDir=../ + outDir=dist/server: source
    // src/server/routes/oped.ts + lib/oped/generate.ts land at dist/server/taxonomy-editor/
    // src/server/routes/oped.js and dist/server/lib/oped/generate.js, so ../../../../lib
    // resolves in dist, tsc, AND vitest (a 3-ups path exists in none — it would 500 at runtime).
    const { generateOpEdSet } = await import('../../../../lib/oped/generate.js');
    const deps: OpEdGeneratorDeps = {
      adapter: createWebOpEdAdapter(),
      // t/2609 relocated the op-ed .prompt files from scripts/AITriad/Prompts to
      // lib/oped/prompts; New-OpEd (PS), the parity gate, and Electron main (#1015) already
      // read the new location. The container ships them at /app/lib/oped/prompts via the
      // companion Dockerfile COPY (Rosetta, repo-root-anchored). Repo-root anchor matches.
      promptsDir: path.join(getProjectRoot(), 'lib', 'oped', 'prompts'),
      repoRoot: getProjectRoot(),
    };
    for await (const event of generateOpEdSet(request, deps) as AsyncGenerator<OpEdProgressEvent>) {
      applyEventToRun(run, event, completed);
      writeFrame(event as unknown as Record<string, unknown>);
      if (event.type === 'complete') {
        await finalizeOpedSet(event.set);
        run.status = Object.values(run.perVoice).some(s => s === 'cancelled') ? 'cancelled' : 'complete';
      }
    }
    if (run.status === 'running') run.status = 'complete';
  } catch (err) {
    run.status = 'error';
    getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Op-ed generation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    if (completed.length > 0) {
      try { await finalizeOpedSet({ schema_version: 1, set_id: request.set_id, topic: request.topic, params: request.params, created_at: new Date().toISOString(), opeds: completed } as OpEdSet); }
      catch { /* telemetry — silent by design (best-effort partial persist) */ }
    }
    writeFrame({ type: 'error', message: String(err) });
  } finally {
    clearInterval(heartbeat);
    run.startedAt = Date.now(); // restart the TTL clock from the terminal state (status-GET window)
    if (!isClientGone()) { try { res.end(); } catch { /* telemetry — silent by design (already closed) */ } }
  }
}

/** set_id validation at the route boundary (the audit class — t/2526 shared
 *  validator): reject a traversal/unsafe id with 400 before the store read. The
 *  store funcs also assertSafeId (defense-in-depth), but pre-validating here maps
 *  a bad id to 400 rather than the store's thrown 400-tagged ActionableError. */
function rejectUnsafeId(res: import('http').ServerResponse, id: string): boolean {
  if (!isSafeId(id)) { error(res, 'Invalid oped-set id', 400); return true; }
  return false;
}

export function registerOpedRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post, put, del } = r;

  // t/2610 (parent epic t/2604): the web op-ed CREATE surface — an SSE stream that
  // runs the shared lib/oped core server-side (the desktop app runs New-OpEd; the web
  // container can't, so generation moved into the TS core). Mirrors routes/chat.ts:
  // POST opens text/event-stream; every JSON error must be sent BEFORE writeHead(200).
  post('/api/oped-sets', async (req, res, body) => {
    // ── Pre-start gate (JSON errors — must precede the SSE headers, TL condition 4) ──
    if (isAnonymousUser()) { error(res, 'Sign in to create op-eds', 403); return; }
    const parsed = parseOpEdCreate(body);
    if (!parsed.ok) { error(res, parsed.message, parsed.status); return; }
    const { topic, povs, params } = parsed.value;
    // Tier-backend entitlement — a free user can't pick a premium backend via params.model
    // (mirrors chat.ts:236); free tier's model is pinned. Must precede any generation.
    const ent = resolveOpEdModel(params);
    if (!ent.ok) { error(res, ent.message, ent.status); return; }

    const userId = getStorageUserId();
    sweepOpedRuns();
    const quota = await getOpedSetsQuotaStatus();
    if (!quota.allowed) { json(res, { error: 'quota_exceeded', resource: quota.resource, current: quota.current, limit: quota.limit }, 429); return; }
    if (countRunningOpedRuns(userId) >= MAX_CONCURRENT_OPED_RUNS) {
      json(res, { error: 'concurrency_limit', message: 'You already have an op-ed generating; wait for it to finish.', limit: MAX_CONCURRENT_OPED_RUNS }, 429); return;
    }

    // ── Commit SSE — no JSON error responses after this point ──
    const runId = randomUUID();
    const setId = randomUUID();
    const ac = new AbortController();
    const run: OpEdRun = { runId, userId, setId, status: 'running', perVoice: Object.fromEntries(povs.map(p => [p, 'pending'])), startedAt: Date.now() };
    opedRuns.set(runId, run);

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    let seq = 0;
    let clientGone = false;
    const writeFrame = (event: Record<string, unknown>): void => {
      if (clientGone) return;
      try { res.write(`data: ${JSON.stringify({ runId, seq: seq++, event })}\n\n`); } catch { clientGone = true; /* telemetry — silent by design (socket closed) */ }
    };
    // Heartbeat so the ACA ingress idle-timeout can't sever a ~2-min multi-voice run.
    const heartbeat = setInterval(() => { if (!clientGone) { try { res.write(': ping\n\n'); } catch { clientGone = true; /* telemetry — silent by design (socket closed) */ } } }, OPED_HEARTBEAT_MS);
    // Cancel on client disconnect — res.on('close'), NOT req.on('close') (Node ≥15 trap,
    // t/2522). driveOpEdRun does NOT break the generator on abort: the core cancels
    // in-flight voices and still yields 'complete' with the PARTIAL set (TL gap 1).
    res.on('close', () => { clientGone = true; ac.abort(); });

    writeFrame({ type: 'run_started', runId });
    // Generate with the entitlement-resolved (free-tier-pinned) model, not the raw request.
    const request: GenerateOpEdRequest = { set_id: setId, topic, params: { ...params, model: ent.model }, povs: povs as PovKey[], signal: ac.signal };
    await driveOpEdRun(res, run, request, writeFrame, heartbeat, () => clientGone);
  });

  // t/2610: observational run status — a dropped SSE stream re-fetches here instead of
  // orphaning the run. Own namespace (not /api/oped-sets/:id) to avoid the :id wildcard.
  // Completion truth is the durable set, so a reconnect that finds no run should fall back
  // to GET /api/oped-sets/:setId (client contract).
  get('/api/oped-runs/:runId', (req, res) => {
    const runId = param(req, 'runId', '/api/oped-runs/:runId');
    if (rejectUnsafeId(res, runId)) return;
    const run = opedRuns.get(runId);
    if (!run || run.userId !== getStorageUserId()) { error(res, 'Run not found', 404); return; }
    json(res, { runId: run.runId, setId: run.setId, status: run.status, perVoice: run.perVoice });
  });

  // Row summaries only (topic/camps/voice_count/dates) — never full docs.
  // .inprogress blobs are invisible (store contract). Anonymous → [].
  get('/api/oped-sets', async (_req, res) => {
    try { json(res, await listOpedSets()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to list oped-sets', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // t/2573: read-only quota pre-check (mirrors GET /api/debates/quota-status).
  // MUST be registered before /api/oped-sets/:id — the :id wildcard would otherwise
  // match "quota-status" (both GET, 3 segments; literal wins by first-match).
  // Delegates to getOpedSetsQuotaStatus() so the pre-check never diverges from the
  // cap the finalizeOpedSet path enforces (Shared Utility Rule).
  get('/api/oped-sets/quota-status', async (_req, res) => {
    try { json(res, await getOpedSetsQuotaStatus()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to check oped quota', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // Load a finalized OpEdSet. Partial sets pass through UNTOUCHED — a member's
  // status ('failed'|'cancelled') is data the reader renders, not an error here.
  get('/api/oped-sets/:id', async (req, res) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    try {
      const set = await loadOpedSet(id);
      if (set === null) { error(res, 'Op-ed set not found', 404); return; }
      json(res, set);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'warn', message: 'Failed to load oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 404, err);
    }
  });

  del('/api/oped-sets/:id', async (req, res) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    try {
      await deleteOpedSet(id);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to delete oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // t/2594 (parent t/2592, TL-approved t/2576#14): rename an existing set — the
  // ONLY mutation on the web build. UPDATE-ONLY: it must never CREATE a set
  // (creation stays Electron-only, TL ruling). Design (p/256#6) fixed the editable
  // field to the set-level `topic`; member headlines/bodies are generated content
  // and are NEVER touched here, so we whitelist `topic` and overlay it onto the
  // STORED set rather than trusting the client's (possibly full-OpEdSet) body.
  put('/api/oped-sets/:id', async (req, res, body) => {
    const id = param(req, 'id', ROUTE_ID);
    if (rejectUnsafeId(res, id)) return;
    const topic = (body as { topic?: unknown } | null)?.topic;
    if (typeof topic !== 'string' || topic.trim() === '' || topic.length > MAX_TOPIC_LEN) {
      error(res, `topic is required and must be a non-empty string (≤${MAX_TOPIC_LEN} chars)`, 400);
      return;
    }
    try {
      // load-then-404 — the load-bearing guard: a PUT to an absent id is NOT a
      // create, it's a 404. Keeps op-ed creation Electron-only.
      const stored = await loadOpedSet(id) as OpEdSet | null;
      if (stored === null) { error(res, 'Op-ed set not found', 404); return; }
      // Existing set → finalizeOpedSet does NOT quota-check (verified: it gates
      // NEW sets only). Only `topic` changes; every member passes through intact.
      await finalizeOpedSet({ ...stored, topic });
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'oped', level: 'error', message: 'Failed to rename oped-set', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500, err);
    }
  });
}
