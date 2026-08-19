// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export artifact store (t/2804, T6). Parallel to opedStore.ts — user-content
// blobs keyed by storageUserId, an _index.json listing, and per-export artifact files.
//
// Lineage: each export record carries its source `debateId`. Artifacts do NOT follow
// debate deletion (spec §10.5) — this store has an independent lifecycle (DELETE only).
//
// Record-vs-policy at storage (T5 lesson, TL MUST t/2804#2): a FAILED export still
// persists its audit-manifest + record so the failure is diagnosable. Only the pptx is
// absent on a render/verify failure; the manifest (which records *why*) is always stored.

import path from 'path';
import { resolveDataPath } from '../config.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { log } from '../logger.js';
import { getStorageUserId, isAnonymousUser } from '../security/userContext.js';
import { getUserContentBackend, assertSafeId } from './fileIO.js';
import { checkQuota, type QuotaCheckResult } from '../security/quotas.js';
import { BRIEF_ARTIFACTS, type BriefArtifactName, type BriefPreset, type ModelSource, type ExportErrorCode } from '../../../../lib/brief/types.js';

// ── Record shape (persisted + listed) ──

export interface BriefExportRecord {
  exportId: string;
  /** Source debate — the lineage link (spec §5). */
  debateId: string;
  title: string;
  preset: BriefPreset;
  status: 'done' | 'failed';
  errorCode?: ExportErrorCode;
  narratorModel: string;
  narratorModelSource: ModelSource;
  checkerModel?: string | null;
  /** Requested output formats actually produced (server: pptx and/or spec). */
  formats: string[];
  /** Artifact filenames present under this export (subset of BRIEF_ARTIFACTS). */
  artifacts: BriefArtifactName[];
  traceCoveragePct: number;
  warnings: string[];
  createdAt: string;
}

/** One artifact to persist: JSON text or binary (pptx). */
export interface ArtifactBlob { name: BriefArtifactName; text?: string; bytes?: Uint8Array }

// ── Dir helpers (mirror opedStore) ──

function getExportsDir(): string {
  const userId = getStorageUserId();
  if (userId === '_local') return resolveDataPath('brief-exports');
  return resolveDataPath(`users/${userId}/brief-exports`);
}
function getExportDir(exportId: string): string {
  return path.join(getExportsDir(), `export-${exportId}`);
}
const INDEX_FILE = '_index.json';

// ── Index helpers ──

async function readIndex(): Promise<BriefExportRecord[]> {
  const raw = await getUserContentBackend().readFile(path.join(getExportsDir(), INDEX_FILE));
  if (raw === null) return [];
  try { return JSON.parse(raw) as BriefExportRecord[]; } catch { /* telemetry — silent by design */ return []; }
}
async function writeIndex(entries: BriefExportRecord[]): Promise<void> {
  await getUserContentBackend().writeFile(path.join(getExportsDir(), INDEX_FILE), JSON.stringify(entries, null, 2));
}
async function upsertIndex(rec: BriefExportRecord): Promise<void> {
  const entries = await readIndex();
  const i = entries.findIndex(e => e.exportId === rec.exportId);
  if (i >= 0) entries[i] = rec; else entries.push(rec);
  await writeIndex(entries);
}
async function removeFromIndex(exportId: string): Promise<void> {
  const entries = await readIndex();
  const filtered = entries.filter(e => e.exportId !== exportId);
  if (filtered.length !== entries.length) await writeIndex(filtered);
}

// ── Public API ──

/** Persist an export: write each artifact under export-<id>/, then upsert the index
 *  record. Called for BOTH done and failed jobs — a failed export still stores its
 *  manifest (+ record) so the failure is diagnosable (TL MUST). The pptx is simply
 *  absent when render/verify failed; the manifest is always present. */
export async function saveBriefExport(rec: BriefExportRecord, artifacts: ArtifactBlob[]): Promise<void> {
  assertSafeId(rec.exportId, 'export id');
  if (isAnonymousUser()) {
    throw new ActionableError({
      goal: 'Store a debate brief export',
      problem: 'Anonymous users cannot store exports',
      location: 'server/storage/briefExportStore.ts → saveBriefExport',
      nextSteps: ['Sign in to export debate briefs'],
    });
  }
  const backend = getUserContentBackend();
  const dir = getExportDir(rec.exportId);
  for (const a of artifacts) {
    const p = path.join(dir, a.name);
    if (a.bytes !== undefined) await backend.writeBinaryFile(p, Buffer.from(a.bytes));
    else await backend.writeFile(p, a.text ?? '');
  }
  await backend.writeFile(path.join(dir, 'record.json'), JSON.stringify(rec, null, 2));
  await upsertIndex(rec).catch((err) => {
    log.server.warn({ err, exportId: rec.exportId }, 'Brief-export index upsert failed (best-effort)');
  });
}

/** Brief-export quota status for the current (non-anonymous) user — exact count + cap.
 *  Shared by saveBriefExport and the GET /api/brief-exports/quota-status pre-check so
 *  they can never diverge (Shared Utility Rule, mirrors getOpedSetsQuotaStatus). */
export async function getBriefExportsQuotaStatus(): Promise<QuotaCheckResult> {
  const entries = await readIndex();
  return checkQuota('brief-exports', entries.length);
}

/** List export records for the current user, optionally filtered to one debate (lineage). */
export async function listBriefExports(debateId?: string): Promise<BriefExportRecord[]> {
  if (isAnonymousUser()) return [];
  const entries = await readIndex();
  return debateId ? entries.filter(e => e.debateId === debateId) : entries;
}

/** Load a single export's record; null if absent or not owned by the caller. */
export async function loadBriefExportRecord(exportId: string): Promise<BriefExportRecord | null> {
  assertSafeId(exportId, 'export id');
  if (isAnonymousUser()) return null;
  const raw = await getUserContentBackend().readFile(path.join(getExportDir(exportId), 'record.json'));
  if (raw === null) return null;
  try { return JSON.parse(raw) as BriefExportRecord; } catch { /* telemetry — silent by design */ return null; }
}

/** Download one artifact. Returns {bytes} for the pptx, {text} for JSON, or null if absent.
 *  `name` MUST be a canonical BRIEF_ARTIFACTS value — the route validates before calling. */
export async function loadBriefArtifact(exportId: string, name: BriefArtifactName): Promise<{ bytes: Buffer } | { text: string } | null> {
  assertSafeId(exportId, 'export id');
  if (isAnonymousUser()) return null;
  const backend = getUserContentBackend();
  const p = path.join(getExportDir(exportId), name);
  if (name === BRIEF_ARTIFACTS.pptx) {
    const bytes = await backend.readBinaryFile(p);
    return bytes === null ? null : { bytes };
  }
  const text = await backend.readFile(p);
  return text === null ? null : { text };
}

/** Delete an export (all artifacts + record) and drop it from the index. Independent of
 *  the source debate's lifecycle (§10.5). */
export async function deleteBriefExport(exportId: string): Promise<void> {
  assertSafeId(exportId, 'export id');
  if (isAnonymousUser()) return;
  const backend = getUserContentBackend();
  const dir = getExportDir(exportId);
  const names: string[] = [...Object.values(BRIEF_ARTIFACTS), 'record.json'];
  await Promise.all(names.map(n => backend.deleteFile(path.join(dir, n)).catch(() => { /* best-effort — file may be absent */ })));
  void removeFromIndex(exportId).catch((err) => {
    log.server.warn({ err, exportId }, 'Brief-export index removal failed (best-effort)');
  });
}
