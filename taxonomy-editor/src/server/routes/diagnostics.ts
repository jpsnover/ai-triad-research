// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1687 (Phase 2 server.ts split, ADR-007): the calibration / flight-recorder /
// chat-sessions route run, moved verbatim out of server.ts behind the
// registration seam. This run sits between registerDebatesRoutes and
// registerCommunityRoutes, so registration order — and the routeTable snapshot —
// is preserved by placing registerDiagnosticsRoutes() at its former position.
//
// serverRecorder + appendServerLogs (the server ring-buffer dump path) come
// through ServerCtx (already present). All other helpers are pure module
// imports (flightRecorderDumps / flightRecorderViewer / accessControl / logger /
// community / fileIO), so no new ServerCtx surface is needed. The one non-verbatim
// change is the dynamic import path for calibrationLogger.js: routes/ is one
// directory deeper than server.ts, so '../../../lib/...' becomes '../../../../lib/...'.

import fs from 'fs';
import path from 'path';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { getDataRoot, getProjectRoot, STORAGE_MODE } from '../config.js';
import { writeDump, isValidDumpId, readMergedDump } from '../flightRecorderDumps.js';
import { escapeForInlineScript } from '../flightRecorderViewer.js';
import { clientSafeMessage } from '../security/accessControl.js';
import { getRequestId } from '../logger.js';
import { log } from '../logger.js';
import * as community from '../community/community.js';
import * as fileIO from '../storage/fileIO.js';

export function registerDiagnosticsRoutes(r: Router, ctx: ServerCtx): void {
  const { get, post, put, del } = r;
  const { serverRecorder, appendServerLogs } = ctx;

  // ── Calibration log (per-debate metrics — JSONL from core/) ──
  get('/api/calibration/log', (_req, res) => {
    try {
      const logPath = path.join(getDataRoot(), 'calibration', 'core', 'calibration-log.jsonl');
      if (!fs.existsSync(logPath)) { json(res, { entries: [], validationReport: null }); return; }

      const entries = fs.readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .map((line: string) => JSON.parse(line));

      const reportPath = path.join(getDataRoot(), 'calibration', 'validation-report.json');
      let validationReport = null;
      if (fs.existsSync(reportPath)) {
        try { validationReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { /* telemetry — silent by design */ }
      }

      json(res, { entries, validationReport });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load parameter entries', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // ── Calibration parameter history ──
  get('/api/calibration/history', async (_req, res) => {
    try {
      const { readParameterHistory, captureSnapshot } = await import('../../../../lib/debate/calibrationLogger.js');
      const history = readParameterHistory(getDataRoot());
      const current = captureSnapshot();
      json(res, { current, history });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to load parameter history', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // ── Flight recorder dump ──
  post('/api/flight-recorder/dump', async (_req, res, body) => {
    try {
      const { ndjson, dumpId } = body as { ndjson: string; dumpId?: string };
      if (!ndjson || typeof ndjson !== 'string') { error(res, 'Missing ndjson field', 400); return; }

      // t/908: when the client supplies a dumpId, write client-{dumpId}.jsonl into
      // the paired-dump dir (joinable to server-{dumpId}.jsonl). Otherwise keep the
      // legacy timestamped behavior.
      if (dumpId !== undefined) {
        if (!isValidDumpId(dumpId)) { error(res, 'dumpId must be a UUID-safe string', 400); return; }
        const filePath = await writeDump(getDataRoot(), 'client', dumpId, ndjson);
        json(res, { filePath, filename: path.basename(filePath), dumpId });
        return;
      }

      const dumpDir = path.join(getDataRoot(), 'flight-recorder');
      fs.mkdirSync(dumpDir, { recursive: true });

      const ts = new Date().toISOString().replace(/:/g, '-');
      const filePath = path.join(dumpDir, `flight-recorder-${ts}.jsonl`);
      fs.writeFileSync(filePath, ndjson, 'utf-8');

      // Retention: keep last 20 files, max 50 MB
      try {
        const files = fs.readdirSync(dumpDir)
          .filter(f => f.startsWith('flight-recorder-') && f.endsWith('.jsonl'))
          .map(f => {
            const fp = path.join(dumpDir, f);
            const stat = fs.statSync(fp);
            return { name: f, path: fp, mtime: stat.mtimeMs, size: stat.size };
          })
          .sort((a, b) => b.mtime - a.mtime);
        for (const f of files.slice(20)) fs.unlinkSync(f.path);
        const remaining = files.slice(0, 20);
        let totalSize = remaining.reduce((s, f) => s + f.size, 0);
        for (let i = remaining.length - 1; i >= 0 && totalSize > 50 * 1024 * 1024; i--) {
          fs.unlinkSync(remaining[i].path);
          totalSize -= remaining[i].size;
        }
      } catch { /* telemetry — silent by design;  retention cleanup is best-effort */ }

      const filename = path.basename(filePath);
      log.fr.info({ filePath }, 'Dump written');
      json(res, { filePath, filename });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // Server-side flight recorder dump
  post('/api/flight-recorder/server-dump', (_req, res) => {
    try {
      const ndjson = appendServerLogs(serverRecorder.buildDump('manual').ndjson);
      const dumpDir = path.join(getDataRoot(), 'flight-recorder');
      fs.mkdirSync(dumpDir, { recursive: true });
      const ts = new Date().toISOString().replace(/:/g, '-');
      const filename = `server-flight-recorder-${ts}.jsonl`;
      const filePath = path.join(dumpDir, filename);
      fs.writeFileSync(filePath, ndjson, 'utf-8');
      log.fr.info({ filePath }, 'Server dump written');
      json(res, { filePath, filename });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to write server flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });


  // t/939: download a single merged (client+server) dump for a dumpId. Mirrors the
  // Merge-FlightRecorderDumps cmdlet — interleaves events by _wall, tags _source,
  // merges headers/dictionaries/contexts; handles a single side gracefully. Admin
  // only: the merge includes the full server ring buffer (other users' internals).
  get('/api/flight-recorder/download-merged/:dumpId', async (req, res) => {
    const dumpId = param(req, 'dumpId', '/api/flight-recorder/download-merged/:dumpId');
    if (!isValidDumpId(dumpId)) { error(res, 'dumpId must be a UUID-safe string', 400); return; }
    // t/1064: the download must NOT fail just because the caller isn't an admin —
    // local/Electron users are '_local' (never admin), so the old blanket
    // requireAdmin gate 403'd the very users running this diagnostic locally. The
    // server ring buffer (other users' internals) stays gated: it's merged in only
    // for admins or single-user/local deployments (no other users). Non-admin web
    // callers still get their own client dump.
    const includeServer = community.isAdmin() || STORAGE_MODE !== 'github-api';
    try {
      const merged = await readMergedDump(getDataRoot(), dumpId, { includeServer });
      if (merged === null) {
        // Actionable, copy-pasteable diagnostics (ADR-001 shape) instead of a bare
        // "failed" — relative paths only, no secrets/absolute fs layout.
        json(res, {
          error: 'merged_dump_unavailable',
          goal: `Download the merged flight-recorder dump for dumpId ${dumpId}`,
          // t/1353: since t/1350 dumps persist through the durable storage backend
          // (Azure Blob in production), so replica recycling / ephemeral-/tmp loss is
          // no longer a cause — the remaining causes are upload timing, retention,
          // a wrong dumpId, or a transient backend read failure.
          problem: 'No readable dump exists for this dumpId in durable storage. Likely: the client dump has not finished uploading yet, the pair was pruned by retention (last 20 dumps / 50 MB), the dumpId is wrong, or a transient storage-backend read failure.',
          location: `admin/flight-recorder-dumps/client-${dumpId}.jsonl${includeServer ? ` (and server-${dumpId}.jsonl)` : ''} in the durable storage backend (Azure Blob in production, local filesystem in dev)`,
          nextSteps: [
            'Re-trigger the dump and wait for the "Flight recorder dump saved" toast before clicking download.',
            "Grep the server flight-recorder log for a `flight-recorder.dump.written` event with this dumpId (t/1352) — it records whether the write landed and which backend received it (blob / github-api / local-fs).",
            'Confirm the client upload succeeded — POST /api/flight-recorder/dump should have returned 200 for this dumpId.',
            includeServer
              ? 'For server-side events, confirm the correlated server dump was written (POST /api/admin/flight-recorder/dump, admin only).'
              : 'Server-side events are admin-only in this deployment, so this download would include client events only.',
            'If the FR log shows a successful write but the read still 404s, inspect the storage backend directly (the admin/flight-recorder-dumps/ prefix in the user-content blob container) — this points to a transient read, not ephemeral loss.',
            `dumpId used: ${dumpId} — verify it matches the saved dump's id.`,
          ],
          dumpId,
          requestId: getRequestId(),
        }, 404);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="merged-${dumpId}.jsonl"`,
      });
      res.end(merged);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'flight-recorder-dumps', level: 'error',
        message: 'Merged dump download failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      json(res, {
        error: 'merged_dump_failed',
        goal: `Download the merged flight-recorder dump for dumpId ${dumpId}`,
        problem: `Merging the dump threw: ${clientSafeMessage(String(err), err)}`,
        location: 'readMergedDump → mergeDumps (server)',
        nextSteps: [
          'Retry the download.',
          'If it persists, download the individual client dump from the same toast and file a bug report with this payload.',
        ],
        dumpId,
        requestId: getRequestId(),
      }, 500);
    }
  });

  get('/api/flight-recorder/list', (_req, res) => {
    try {
      const dumpDir = path.join(getDataRoot(), 'flight-recorder');
      if (!fs.existsSync(dumpDir)) { json(res, { files: [] }); return; }
      const files = fs.readdirSync(dumpDir)
        .filter(f => f.endsWith('.jsonl') && /^(server-)?flight-recorder-/.test(f))
        .map(f => {
          const stat = fs.statSync(path.join(dumpDir, f));
          return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
      json(res, { files });
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to list flight-recorder dumps',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      error(res, String(err));
    }
  });

  get('/api/flight-recorder/download/:filename', (req, res) => {
    try {
      const filename = decodeURIComponent(param(req, 'filename', '/api/flight-recorder/download/:filename'));
      // Sanitize: allow flight-recorder-*.jsonl and server-flight-recorder-*.jsonl
      if (!/^(server-)?flight-recorder-.+\.jsonl$/.test(filename)) {
        error(res, 'Invalid filename', 400);
        return;
      }
      const dumpDir = path.join(getDataRoot(), 'flight-recorder');
      const filePath = path.join(dumpDir, filename);
      if (!fs.existsSync(filePath)) { error(res, 'File not found', 404); return; }
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.end(content);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to download flight-recorder dump', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  get('/api/flight-recorder/view/:filename', (req, res) => {
    try {
      const filename = decodeURIComponent(param(req, 'filename', '/api/flight-recorder/view/:filename'));
      if (!/^(server-)?flight-recorder-.+\.jsonl$/.test(filename)) {
        error(res, 'Invalid filename', 400);
        return;
      }
      const dumpDir = path.join(getDataRoot(), 'flight-recorder');
      const filePath = path.join(dumpDir, filename);
      if (!fs.existsSync(filePath)) { error(res, 'File not found', 404); return; }

      const viewerPath = path.join(getProjectRoot(), 'tools', 'flight-recorder-viewer.html');
      if (!fs.existsSync(viewerPath)) { error(res, 'Viewer HTML not found', 500); return; }

      const dumpContent = fs.readFileSync(filePath, 'utf-8');
      const viewerHtml = fs.readFileSync(viewerPath, 'utf-8');

      // Escape for inline <script> embedding — crucially neutralizes any
      // `</script>` sequence in the dump so it can't break out (reflected XSS, M3).
      const escaped = escapeForInlineScript(dumpContent);

      const autoLoadScript = `<script>
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('fileName').textContent = '${escapeForInlineScript(filename)}';
  parseNdjson(\`${escaped}\`);
});
</script>`;

      const outputHtml = viewerHtml.replace('</body>', `${autoLoadScript}\n</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(outputHtml);
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to render flight-recorder viewer', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });

  // ── Chat sessions ──

  get('/api/chats', async (_req, res) => { json(res, await fileIO.listChatSessions()); });

  get('/api/chats/:id', async (req, res) => {
    try { json(res, await fileIO.loadChatSession(param(req, 'id', '/api/chats/:id'))); }
    catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'warn', message: 'Failed to load chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 404, err); }
  });

  put('/api/chats', async (_req, res, body) => {
    try { await fileIO.saveChatSession(body); json(res, { ok: true }); }
    catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'server',
        level: 'error',
        message: 'Failed to save chat session',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      const qi = (err as { quotaInfo?: { resource: string; current: number; limit: number } }).quotaInfo;
      if (qi) { json(res, { error: 'quota_exceeded', resource: qi.resource, current: qi.current, limit: qi.limit, message: String(err) }, status); }
      else { error(res, String(err), status); }
    }
  });

  del('/api/chats/:id', async (req, res) => {
    try {
      await fileIO.deleteChatSession(param(req, 'id', '/api/chats/:id'));
      json(res, { ok: true });
    } catch (err) { getGlobalRecorder()?.record({ type: 'system.error', component: 'server', level: 'error', message: 'Failed to delete chat session', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } }); error(res, String(err), 500, err); }
  });
}
