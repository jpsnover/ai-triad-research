// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1295 (route extraction, repo-review B-209): the /api/debates route cluster,
// moved verbatim out of server.ts behind the registration seam. Handlers are
// unchanged; only their relative import paths gained one `../` (this file is one
// directory deeper than server.ts — see routeTable.test.ts for the invariant
// that proves the move is zero-behaviour-change). The debates handlers depend
// only on module-level imports, so ServerCtx is threaded but unused here.

import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import type { ServerResponse } from 'http';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as fileIO from '../storage/fileIO.js';
import * as ai from '../ai/aiBackends.js';
import { getStorageUserId, getAnonymousSessionId } from '../security/userContext.js';
import * as rateLimiter from '../security/rateLimiter.js';
import { getDataRoot } from '../config.js';
import type { DebateDelta } from '../../../../lib/debate/types.js';

// t/1461: per-{userId,debateId} in-flight guard against the concurrent debate-save
// cascade — an actively-used debate fires saveDebate from many store transitions,
// so without this N overlapping full-payload blob uploads run at once, each hanging
// to the client's 180s abort on a cold replica. Process-local (per-replica); the
// cross-replica coalesce is the client's job (t/1468). SLOW_DEBATE_SAVE_MS gates the
// slow-save diagnostic FR log that feeds the Server Storage blob-timeout ticket (t/1469).
const inFlightDebateSaves = new Set<string>();
const SLOW_DEBATE_SAVE_MS = 5_000;
const ANON_DEBATE_SAVE_RPM = 30;

/** Append a calibration data point when the saved debate has a concluding entry.
 *  Never blocks/aborts the save — a failure is recorded to the flight recorder. */
async function logCalibrationIfComplete(body: unknown): Promise<void> {
  try {
    const session = body as { id?: string; transcript?: { type: string }[]; neutral_evaluations?: unknown[] };
    if (session?.transcript?.some(e => e.type === 'concluding')) {
      const { extractCalibrationData, appendCalibrationLog } = await import('../../../../lib/debate/calibrationLogger.js');
      // `body` is the saved debate session at runtime; the local narrow type above
      // is only for the transcript check, so cast to the function's param.
      const dataPoint = extractCalibrationData(session as unknown as Parameters<typeof extractCalibrationData>[0], getStorageUserId());
      appendCalibrationLog(dataPoint, getDataRoot());
    }
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'calibration', level: 'warn',
      message: 'Calibration logging skipped after save',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
  }
}

/** t/1461 slow-save diagnostic: on the slow path only (>5s), record payload size +
 *  duration — the sizing data the blob-timeout ticket (t/1469) is blocked on. */
function recordSlowSaveIfNeeded(debateId: string | undefined, body: unknown, startedAt: number): void {
  const durationMs = Date.now() - startedAt;
  if (durationMs > SLOW_DEBATE_SAVE_MS) {
    getGlobalRecorder()?.record({
      type: 'lifecycle', component: 'debates', level: 'warn',
      message: `Slow debate save: ${durationMs}ms`,
      data: { debateId, userId: getStorageUserId(), payload_bytes: Buffer.byteLength(JSON.stringify(body)), duration_ms: durationMs },
    });
  }
}

/** Emit the failed-save response: a structured quota_exceeded body when quotaInfo
 *  is present, else the generic error(). The flight-recorder call stays literally
 *  in the catch (ADR-003); this is only the non-recording response tail. */
function respondDebateSaveError(res: ServerResponse, err: unknown): void {
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  const qi = (err as { quotaInfo?: { resource: string; current: number; limit: number } }).quotaInfo;
  if (qi) { json(res, { error: 'quota_exceeded', resource: qi.resource, current: qi.current, limit: qi.limit, message: String(err) }, status); }
  else { error(res, String(err), status); }
}

/** Pull the news-report input fields out of a saved session (argument-network
 *  nodes/edges, synthesis json, doc analysis, topic, audience) with the tolerant
 *  optional/`??` fallbacks the raw session shape needs. */
function extractNewsReportFields(
  session: Record<string, unknown>,
  transcript: Array<{ type: string; content: string; speaker: string }>,
): { anNodes: unknown[]; anEdges: unknown[]; synthesisJson: string; docAnalysis: string | undefined; topic: string; audience: string | undefined } {
  const anNodes = ((session.argument_network as Record<string, unknown>)?.nodes ?? []) as unknown[];
  const anEdges = ((session.argument_network as Record<string, unknown>)?.edges ?? []) as unknown[];
  const synthesisEntry = transcript.find(e => e.type === 'synthesis' || e.type === 'concluding');
  const synthesisJson = synthesisEntry?.content ?? '';
  const docAnalysis = (session.document_analysis as string | undefined) ?? undefined;
  const topic = ((session.topic as Record<string, unknown>)?.refined ?? (session.topic as Record<string, unknown>)?.original ?? '') as string;
  const audience = (session.audience as string | undefined) ?? undefined;
  return { anNodes, anEdges, synthesisJson, docAnalysis, topic, audience };
}

export function registerDebatesRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post, put, patch, del } = r;

  get('/api/debates', async (_req, res) => { json(res, await fileIO.listDebateSessions()); });
  get('/api/debates/list', async (_req, res) => {
    const entries = await fileIO.listDebateSessionsMeta() as Record<string, unknown>[];
    json(res, entries.map(e => ({ ...e, source: 'user' })));
  });

  // t/1360: read-only quota pre-check for the New Debate button (t/1358). MUST be
  // registered before /api/debates/:id — the :id wildcard would otherwise match
  // "quota-status" (both GET, 3 segments; literal wins by first-match). Delegates
  // to fileIO.getDebatesQuotaStatus() so the pre-check never diverges from the
  // count the save path enforces.
  get('/api/debates/quota-status', async (_req, res) => {
    try {
      json(res, await fileIO.getDebatesQuotaStatus());
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'error', message: 'Failed to check debate quota', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  get('/api/debates/:id', async (req, res) => {
    try { json(res, await fileIO.loadDebateSession(param(req, 'id', '/api/debates/:id'))); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'warn', message: 'Failed to load debate session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 404, err);
    }
  });

  put('/api/debates', async (_req, res, body) => {
    // t/1461: reject a concurrent save of the same debate rather than running
    // overlapping full-payload blob uploads. The in-flight (possibly OLDER) save
    // persists; the rejected (newer) request is NOT saved now — the client re-fires
    // the latest dirty state after the in-flight completes, keyed on this exact
    // `error: 'save_in_progress'` value (t/1468). Backstop only — per-process, so
    // same-replica; the client coalesce is the cross-replica fix.
    const debateId = (body as { id?: string })?.id;
    const saveKey = debateId ? `${getStorageUserId()}:${debateId}` : null;
    if (saveKey && inFlightDebateSaves.has(saveKey)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'save_in_progress', message: 'A save for this debate is already in progress; your newest changes will be saved on the next attempt.' }));
      return;
    }
    if (saveKey) inFlightDebateSaves.add(saveKey);
    const startedAt = Date.now();
    try {
      // t/700: user content (debates/chats/community) lives in Azure Blob, keyed by
      // storageUserId — no GitHub session branch needed. Closing the github-api
      // rollback window (authorized e/19#28).
      await fileIO.saveDebateSession(body, 'PUT /api/debates');

      await logCalibrationIfComplete(body);
      recordSlowSaveIfNeeded(debateId, body, startedAt);

      json(res, { ok: true });
    }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to save debate session',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      respondDebateSaveError(res, err);
    }
    finally {
      // Clear the guard even on a thrown/aborted save (the 180s scenario) so a hung
      // save never leaves a permanently-409ing debate (Quality condition 3).
      if (saveKey) inFlightDebateSaves.delete(saveKey);
    }
  });

  // t/1636 (parent t/1470): delta save. Instead of re-uploading the full debate
  // blob on every dirty transition (the PUT above), PATCH ships only the changed
  // surfaces (DebateDelta) and the storage layer merges them under an exact
  // baseVersion match. Mirrors PUT's in-flight guard + slow-save FR verbatim so the
  // two save paths coalesce identically per replica. Two distinct 409 codes: the
  // in-flight guard's `save_in_progress` (retry same delta later) and the storage
  // layer's `version_conflict` (baseVersion stale — client falls back to a full PUT).
  patch('/api/debates/:id', async (req, res, body) => {
    const debateId = param(req, 'id', '/api/debates/:id');
    // debateId is always present (path param), so unlike PUT the saveKey is never null.
    const saveKey = `${getStorageUserId()}:${debateId}`;
    if (inFlightDebateSaves.has(saveKey)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'save_in_progress', message: 'A save for this debate is already in progress; your newest changes will be saved on the next attempt.' }));
      return;
    }
    const anonSessionId = getAnonymousSessionId();
    if (anonSessionId) {
      const r = rateLimiter.checkRate(`anon-debate-save:${anonSessionId}`, ANON_DEBATE_SAVE_RPM, 60_000);
      if (!r.allowed) {
        const retryAfter = Math.max(1, Math.ceil((r.retryAfterMs ?? 60_000) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        return json(res, { error: 'rate_limited', message: 'Too many requests', retryAfter }, 429);
      }
    }
    inFlightDebateSaves.add(saveKey);
    const startedAt = Date.now();
    try {
      const delta = body as DebateDelta;
      const { newVersion } = await fileIO.applyDebateDeltaToStorage(delta);

      // t/1461: slow-save diagnostic — same >5s payload-size probe as PUT, so the
      // Server Storage blob-timeout ticket (t/1469) sees delta saves too.
      const durationMs = Date.now() - startedAt;
      if (durationMs > SLOW_DEBATE_SAVE_MS) {
        getGlobalRecorder()?.record({
          type: 'lifecycle', component: 'debates', level: 'warn',
          message: `Slow debate delta save: ${durationMs}ms`,
          data: { debateId, userId: getStorageUserId(), payload_bytes: Buffer.byteLength(JSON.stringify(body)), duration_ms: durationMs },
        });
      }

      json(res, { newVersion });
    }
    catch (err) {
      // Storage signals a stale/absent baseVersion via ActionableError with
      // code 'version_conflict' + currentVersion. Surface it as a distinct 409 so
      // the client can fall back to a full PUT. error() already FR-records 4xx at
      // warn, so this path returns before the unconditional system.error below.
      if ((err as { code?: string }).code === 'version_conflict') {
        json(res, { currentVersion: (err as { currentVersion?: number }).currentVersion, code: 'version_conflict' }, 409);
        return;
      }
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to apply debate delta',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err), (err as { statusCode?: number }).statusCode ?? 500);
    }
    finally {
      inFlightDebateSaves.delete(saveKey);
    }
  });

  del('/api/debates/:id', async (req, res) => {
    try {
      await fileIO.deleteDebateSession(param(req, 'id', '/api/debates/:id'));
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'error', message: 'Failed to delete debate session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  get('/api/debates/:id/comments', async (req, res) => {
    try {
      const id = param(req, 'id', '/api/debates/:id/comments');
      // t/856: 404 for a debate the caller doesn't own (was 200 + empty list),
      // for consistency with sibling endpoints.
      if (!(await fileIO.loadDebateSession(id))) { error(res, 'Debate not found', 404); return; }
      json(res, await fileIO.loadDebateComments(id));
    }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'warn', message: 'Failed to load debate comments', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 404, err);
    }
  });

  put('/api/debates/:id/comments', async (req, res, body) => {
    try {
      const debateId = param(req, 'id', '/api/debates/:id/comments');
      await fileIO.saveDebateComments(debateId, body);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'error', message: 'Failed to save debate comments', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  post('/api/debates/export', (_req, res, body) => {
    // In web mode, return the formatted content for browser download
    const session = body as Record<string, unknown>;
    json(res, { content: JSON.stringify(session, null, 2), filename: `debate-${session.id || 'export'}.json` });
  });

  post('/api/debates/:id/news-report', async (req, res) => {
    try {
      const debateId = param(req, 'id', '/api/debates/:id/news-report');
      const session = await fileIO.loadDebateSession(debateId) as Record<string, unknown>;
      const transcript = (session.transcript ?? []) as Array<{ type: string; content: string; speaker: string }>;
      const hasSynthesis = transcript.some(e => e.type === 'synthesis' || e.type === 'concluding');
      if (!hasSynthesis) { error(res, 'A synthesis must exist before generating a news report.', 400); return; }

      // @ts-expect-error — lib/debate uses bundler moduleResolution; dynamic import resolves at runtime
      const { extractTranscriptHighlights, summarizeArgumentNetwork } = await import('../../../lib/debate/newsReport.js');
      // @ts-expect-error — lib/debate uses bundler moduleResolution; dynamic import resolves at runtime
      const { newsReportPrompt } = await import('../../../lib/debate/prompts.js');

      const { anNodes, anEdges, synthesisJson, docAnalysis, topic, audience } = extractNewsReportFields(session, transcript);
      const highlights = extractTranscriptHighlights(transcript as never[], anNodes as never[]);
      const argSummary = summarizeArgumentNetwork(anNodes as never[], anEdges as never[]);
      const prompt = newsReportPrompt(topic, synthesisJson, argSummary, highlights, docAnalysis, undefined, audience as import('../../../../lib/debate/types.js').DebateAudience | undefined);
      const result = await ai.generateTextByUsage('server.news-report', { prompt });
      json(res, { article: result.text });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'error', message: 'News report generation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });
}
