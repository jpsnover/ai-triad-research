// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief template REST API (t/2853). Upload, list, and delete user-owned .potx templates
// that the render pipeline uses for slide masters.
//
// Endpoints:
//   POST   /api/templates   — upload a .potx (raw binary body), store per-user, return TemplateRecord
//   GET    /api/templates   — list stored templates
//   DELETE /api/templates/:id
//
// Body is consumed by readBody (server.ts) before handlers run; binary bytes are available
// on req.__rawBodyBuffer (added t/2853 — server.ts stores Buffer alongside the UTF-8 string).

import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Router } from '../httpKit.js';
import type { ServerCtx } from './context.js';
import { json, error, param } from '../httpKit.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { isAnonymousUser } from '../security/userContext.js';
import { saveTemplate, listTemplates, deleteTemplate } from '../storage/templateStore.js';

type RawBodyReq = IncomingMessage & { __rawBodyBuffer?: Buffer };

const MAX_TEMPLATE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function registerTemplatesRoutes(r: Router, _ctx: ServerCtx): void {
  const { get, post, del } = r;

  // ── POST /api/templates ──
  // Raw binary body; x-filename header carries the original filename.
  post('/api/templates', async (req, res) => {
    if (isAnonymousUser()) { error(res, 'Sign in to upload templates', 403); return; }

    const bytes = (req as RawBodyReq).__rawBodyBuffer ?? Buffer.alloc(0);

    if (bytes.length === 0) { error(res, 'Empty template body', 400); return; }
    if (bytes.length > MAX_TEMPLATE_SIZE_BYTES) {
      error(res, `Template file too large (max ${MAX_TEMPLATE_SIZE_BYTES / 1024 / 1024} MB)`, 413);
      return;
    }

    const rawName = (req.headers['x-filename'] as string | undefined) ?? 'template.potx';
    const safeName = rawName.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
    if (!safeName.toLowerCase().endsWith('.potx')) {
      error(res, 'Only .potx files are accepted as brief templates', 400);
      return;
    }

    const templateId = randomUUID();
    const rec = { templateId, name: safeName, size: bytes.length, createdAt: new Date().toISOString() };
    try {
      await saveTemplate(rec, bytes);
      json(res, rec, 201);
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'templates', level: 'error', message: 'Failed to save template', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // ── GET /api/templates ──
  get('/api/templates', async (_req, res) => {
    try { json(res, await listTemplates()); }
    catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'templates', level: 'error', message: 'Failed to list templates', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });

  // ── DELETE /api/templates/:id ──
  del('/api/templates/:id', async (req, res) => {
    if (isAnonymousUser()) { error(res, 'Sign in to manage templates', 403); return; }
    const templateId = param(req, 'id', '/api/templates/:id');
    try {
      await deleteTemplate(templateId);
      json(res, { ok: true });
    } catch (err) {
      getGlobalRecorder()?.record({ type: 'system.error', component: 'templates', level: 'error', message: 'Failed to delete template', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      error(res, String(err), 500, err);
    }
  });
}
