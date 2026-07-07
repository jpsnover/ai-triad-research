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
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import * as fileIO from '../storage/fileIO.js';
import * as ai from '../ai/aiBackends.js';
import { getStorageUserId } from '../security/userContext.js';
import { getDataRoot } from '../config.js';

export function registerDebatesRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post, put, del } = r;

  get('/api/debates', async (_req, res) => { json(res, await fileIO.listDebateSessions()); });
  get('/api/debates/list', async (_req, res) => { json(res, await fileIO.listDebateSessionsMeta()); });

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
    try {
      // t/700: user content (debates/chats/community) lives in Azure Blob, keyed by
      // storageUserId — no GitHub session branch needed. Closing the github-api
      // rollback window (authorized e/19#28).
      await fileIO.saveDebateSession(body);

      // Log calibration data if debate has synthesis (completed debate)
      try {
        const session = body as { id?: string; transcript?: { type: string }[]; neutral_evaluations?: unknown[] };
        if (session?.transcript?.some(e => e.type === 'concluding')) {
          const { extractCalibrationData, appendCalibrationLog } = await import('../../../../lib/debate/calibrationLogger.js');
          // `body` is the saved debate session at runtime; the local narrow type
          // above is only for the transcript check. The await import() is now typed
          // (require's `any` previously hid this), so cast to the function's param.
          const dataPoint = extractCalibrationData(session as unknown as Parameters<typeof extractCalibrationData>[0], getStorageUserId());
          appendCalibrationLog(dataPoint, getDataRoot());
        }
      } catch (err) {
        // Calibration logging never blocks the save, but record so silent
        // extraction/append failures are visible in dumps.
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'calibration', level: 'warn',
          message: 'Calibration logging skipped after save',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      }

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
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      const qi = (err as { quotaInfo?: { resource: string; current: number; limit: number } }).quotaInfo;
      if (qi) { json(res, { error: 'quota_exceeded', resource: qi.resource, current: qi.current, limit: qi.limit, message: String(err) }, status); }
      else { error(res, String(err), status); }
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

      const anNodes = ((session.argument_network as Record<string, unknown>)?.nodes ?? []) as unknown[];
      const anEdges = ((session.argument_network as Record<string, unknown>)?.edges ?? []) as unknown[];
      const highlights = extractTranscriptHighlights(transcript as never[], anNodes as never[]);
      const argSummary = summarizeArgumentNetwork(anNodes as never[], anEdges as never[]);
      const synthesisEntry = transcript.find(e => e.type === 'synthesis' || e.type === 'concluding');
      const synthesisJson = synthesisEntry?.content ?? '';
      const docAnalysis = (session.document_analysis as string | undefined) ?? undefined;
      const topic = ((session.topic as Record<string, unknown>)?.refined ?? (session.topic as Record<string, unknown>)?.original ?? '') as string;

      const audience = (session.audience as string | undefined) ?? undefined;
      const prompt = newsReportPrompt(topic, synthesisJson, argSummary, highlights, docAnalysis, undefined, audience as import('../../../../lib/debate/types.js').DebateAudience | undefined);
      const result = await ai.generateTextByUsage('server.news-report', { prompt });
      json(res, { article: result.text });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'debates', level: 'error', message: 'News report generation failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });
}
