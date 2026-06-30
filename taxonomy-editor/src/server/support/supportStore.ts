// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/1189 (support ticketing): storage helpers over the user-content backend
// (Azure Blob in prod). Layout: support-cases/{userId}/{caseId}/case.json (+
// attachments/{attachmentId}.bin once writeBinaryFile lands — t/1216).

import crypto from 'crypto';
import path from 'path';
import { resolveDataPath } from '../config.js';
import { getUserContentBackend, assertSafeId } from '../storage/fileIO.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import type { SupportCase, CaseStatus, CaseResponse, SupportCaseSystemInfo, Attachment } from './types.js';
import { isAllowedAttachmentMime, ATTACHMENT_MAX_BYTES, CASE_MAX_TOTAL_BYTES, CASE_MAX_ATTACHMENTS } from './types.js';

const ROOT = 'support-cases';

function userDir(userId: string): string {
  assertSafeId(userId, 'user id');
  return resolveDataPath(path.join(ROOT, userId));
}
function caseDir(userId: string, caseId: string): string {
  assertSafeId(userId, 'user id');
  assertSafeId(caseId, 'case id');
  return resolveDataPath(path.join(ROOT, userId, caseId));
}
function casePath(userId: string, caseId: string): string {
  return path.join(caseDir(userId, caseId), 'case.json');
}
/** Blob path for an attachment file (relative path the StorageBackend resolves). */
export function attachmentBlobPath(userId: string, caseId: string, attachmentId: string): string {
  assertSafeId(attachmentId, 'attachment id');
  return path.join(caseDir(userId, caseId), 'attachments', `${attachmentId}.bin`);
}

async function readCaseAt(userId: string, caseId: string): Promise<SupportCase | null> {
  const backend = getUserContentBackend();
  const raw = await backend.readFile(casePath(userId, caseId));
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as SupportCase;
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'support', level: 'warn',
      message: 'Skipping unparseable support case',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      data: { userId, caseId },
    });
    return null;
  }
}

async function writeCase(c: SupportCase): Promise<void> {
  c.updatedAt = new Date().toISOString();
  await getUserContentBackend().writeFile(casePath(c.userId, c.id), JSON.stringify(c, null, 2));
}

/** caseId directory names under a user's support-cases dir. */
async function listCaseIds(userId: string): Promise<string[]> {
  return (await getUserContentBackend().listDirectory(userDir(userId)))
    .filter(name => !name.includes('.')); // case dirs only (skip stray files)
}

export async function createCase(
  userId: string,
  userDisplayName: string,
  input: { subject: string; description: string; systemInfo: SupportCaseSystemInfo; priority?: SupportCase['priority'] },
): Promise<SupportCase> {
  const now = new Date().toISOString();
  const c: SupportCase = {
    id: crypto.randomUUID(),
    userId,
    userDisplayName,
    subject: input.subject,
    description: input.description,
    status: 'open',
    priority: input.priority ?? 'medium',
    createdAt: now,
    updatedAt: now,
    attachments: [],
    responses: [],
    systemInfo: input.systemInfo,
  };
  await getUserContentBackend().writeFile(casePath(userId, c.id), JSON.stringify(c, null, 2));
  return c;
}

/** A case owned by `userId`. Returns null if it doesn't exist (or isn't theirs). */
export async function getCase(userId: string, caseId: string): Promise<SupportCase | null> {
  return readCaseAt(userId, caseId);
}

export async function listCasesForUser(userId: string): Promise<SupportCase[]> {
  const ids = await listCaseIds(userId);
  const cases = await Promise.all(ids.map(id => readCaseAt(userId, id)));
  return cases.filter((c): c is SupportCase => c !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Admin: every case across all users (newest first). N+M scan — fine at low scale. */
export async function listAllCases(): Promise<SupportCase[]> {
  const userIds = (await getUserContentBackend().listDirectory(resolveDataPath(ROOT)))
    .filter(name => !name.includes('.'));
  const perUser = await Promise.all(userIds.map(uid => listCasesForUser(uid).catch(() => [])));
  return perUser.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Admin: locate a case by id alone (scans users). Returns null if not found. */
export async function findCaseById(caseId: string): Promise<SupportCase | null> {
  assertSafeId(caseId, 'case id');
  const userIds = (await getUserContentBackend().listDirectory(resolveDataPath(ROOT)))
    .filter(name => !name.includes('.'));
  for (const uid of userIds) {
    const c = await readCaseAt(uid, caseId);
    if (c) return c;
  }
  return null;
}

/** Admin: append a response. Returns the updated case, or null if not found. */
export async function addResponse(caseId: string, authorId: string, body: string): Promise<SupportCase | null> {
  const c = await findCaseById(caseId);
  if (!c) return null;
  const resp: CaseResponse = { id: crypto.randomUUID(), authorId, body, createdAt: new Date().toISOString() };
  c.responses.push(resp);
  await writeCase(c);
  return c;
}

/** Admin: change status (sets resolvedAt on resolved/closed). Null if not found. */
export async function setStatus(caseId: string, status: CaseStatus): Promise<SupportCase | null> {
  const c = await findCaseById(caseId);
  if (!c) return null;
  c.status = status;
  if (status === 'resolved' || status === 'closed') c.resolvedAt = new Date().toISOString();
  else c.resolvedAt = undefined;
  await writeCase(c);
  return c;
}

/** Download: attachment metadata + bytes (reads the binary blob). Null if missing. */
export async function getAttachment(
  userId: string, caseId: string, attachmentId: string,
): Promise<{ meta: Attachment; bytes: Buffer } | null> {
  const c = await readCaseAt(userId, caseId);
  if (!c) return null;
  const meta = c.attachments.find(a => a.id === attachmentId);
  if (!meta) return null;
  const bytes = await getUserContentBackend().readBinaryFile(meta.blobPath);
  if (bytes == null) return null;
  return { meta, bytes };
}

export type SaveAttachmentResult =
  | { ok: true; attachment: Attachment; case: SupportCase }
  | { ok: false; status: number; error: string };

/**
 * Validate (MIME allowlist + per-attachment / per-case / count limits, all on the
 * DECODED bytes) and persist a binary attachment as a real blob (t/1216
 * writeBinaryFile), appending its metadata to the case. (t/1189)
 */
export async function saveAttachment(
  userId: string, caseId: string, input: { filename: string; mimeType: string; bytes: Buffer },
): Promise<SaveAttachmentResult> {
  const c = await readCaseAt(userId, caseId);
  if (!c) return { ok: false, status: 404, error: 'Case not found' };
  if (!isAllowedAttachmentMime(input.mimeType)) return { ok: false, status: 400, error: `Unsupported attachment type: ${input.mimeType}` };
  if (input.bytes.length === 0) return { ok: false, status: 400, error: 'Empty attachment' };
  if (input.bytes.length > ATTACHMENT_MAX_BYTES) return { ok: false, status: 413, error: `Attachment exceeds the ${ATTACHMENT_MAX_BYTES}-byte limit` };
  if (c.attachments.length >= CASE_MAX_ATTACHMENTS) return { ok: false, status: 400, error: `A case may have at most ${CASE_MAX_ATTACHMENTS} attachments` };
  const currentTotal = c.attachments.reduce((sum, a) => sum + a.sizeBytes, 0);
  if (currentTotal + input.bytes.length > CASE_MAX_TOTAL_BYTES) {
    return { ok: false, status: 413, error: `Adding this attachment would exceed the ${CASE_MAX_TOTAL_BYTES}-byte per-case limit` };
  }

  const attachmentId = crypto.randomUUID();
  const blobPath = attachmentBlobPath(userId, caseId, attachmentId);
  await getUserContentBackend().writeBinaryFile(blobPath, input.bytes);

  const meta: Attachment = {
    id: attachmentId,
    filename: String(input.filename || 'attachment').slice(0, 255),
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    blobPath,
    uploadedAt: new Date().toISOString(),
  };
  c.attachments.push(meta);
  await writeCase(c);
  return { ok: true, attachment: meta, case: c };
}
