// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief template store (t/2853). Mirrors briefExportStore.ts — per-user directory under
// users/<storageUserId>/brief-templates/, each template gets its own subdirectory with
// the .potx blob + record.json. An _index.json provides a flat listing.
// Anonymous users are rejected at the API boundary before any store call.

import path from 'path';
import { resolveDataPath } from '../config.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { log } from '../logger.js';
import { getBriefExportBackend, assertSafeId } from './fileIO.js';
import { isAnonymousUser, getStorageUserId } from '../security/userContext.js';

export interface TemplateRecord {
  templateId: string;
  name: string;
  size: number;
  createdAt: string;
}

const TEMPLATE_FILE = 'template.potx';
const INDEX_FILE = '_index.json';

function getTemplatesDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('brief-templates');
  return resolveDataPath(`users/${userId}/brief-templates`);
}
function getTemplateDir(templateId: string): string {
  return path.join(getTemplatesDir(), `template-${templateId}`);
}

async function readIndex(): Promise<TemplateRecord[]> {
  const raw = await getBriefExportBackend().readFile(path.join(getTemplatesDir(), INDEX_FILE));
  if (raw === null) return [];
  try { return JSON.parse(raw) as TemplateRecord[]; } catch { /* telemetry — silent by design */ return []; }
}
async function writeIndex(entries: TemplateRecord[]): Promise<void> {
  await getBriefExportBackend().writeFile(path.join(getTemplatesDir(), INDEX_FILE), JSON.stringify(entries, null, 2));
}
async function upsertIndex(rec: TemplateRecord): Promise<void> {
  const entries = await readIndex();
  const i = entries.findIndex(e => e.templateId === rec.templateId);
  if (i >= 0) entries[i] = rec; else entries.push(rec);
  await writeIndex(entries);
}
async function removeFromIndex(templateId: string): Promise<void> {
  const entries = await readIndex();
  const filtered = entries.filter(e => e.templateId !== templateId);
  if (filtered.length !== entries.length) await writeIndex(filtered);
}

export async function saveTemplate(rec: TemplateRecord, bytes: Buffer): Promise<void> {
  assertSafeId(rec.templateId, 'template id');
  if (isAnonymousUser()) {
    throw new ActionableError({
      goal: 'Store a brief template',
      problem: 'Anonymous users cannot store templates',
      location: 'server/storage/templateStore.ts → saveTemplate',
      nextSteps: ['Sign in to upload brief templates'],
    });
  }
  const backend = getBriefExportBackend();
  const dir = getTemplateDir(rec.templateId);
  await backend.writeBinaryFile(path.join(dir, TEMPLATE_FILE), bytes);
  await backend.writeFile(path.join(dir, 'record.json'), JSON.stringify(rec, null, 2));
  await upsertIndex(rec).catch(err => {
    log.server.warn({ err, templateId: rec.templateId }, 'Template index upsert failed (best-effort)');
  });
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  if (isAnonymousUser()) return [];
  return readIndex();
}

export async function loadTemplateBytes(templateId: string): Promise<Buffer | null> {
  assertSafeId(templateId, 'template id');
  if (isAnonymousUser()) return null;
  return getBriefExportBackend().readBinaryFile(path.join(getTemplateDir(templateId), TEMPLATE_FILE));
}

export async function deleteTemplate(templateId: string): Promise<void> {
  assertSafeId(templateId, 'template id');
  if (isAnonymousUser()) return;
  const backend = getBriefExportBackend();
  const dir = getTemplateDir(templateId);
  await backend.deleteFile(path.join(dir, TEMPLATE_FILE)).catch(() => { /* absent is fine */ });
  await backend.deleteFile(path.join(dir, 'record.json')).catch(() => { /* absent is fine */ });
  void removeFromIndex(templateId).catch(err => {
    log.server.warn({ err, templateId }, 'Template index removal failed (best-effort)');
  });
}
