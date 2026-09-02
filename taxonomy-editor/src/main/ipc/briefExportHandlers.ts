// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Brief Export — Electron main-process parity (t/2840). Desktop backend for the 5 brief-export
// AppAPI methods (create / get-job / list / download-artifact / delete). Runs the SHARED
// lib/brief `runBriefPipeline` (t/2837) in-process — the 3rd caller (web REST + PS CLI + this),
// never a reimplementation. Mirrors T6's briefExportJobs *shell* (job map + async runner) MINUS
// the server-only concerns: desktop is single-user, so there is no anon-auth, no entitlement
// gate, no per-user quota, no concurrency cap. Storage is the local filesystem under userData.
//
// Download returns raw bytes (the renderer/electron-bridge wraps them into a Blob) — the
// downloadBriefArtifact AppAPI stays Blob-returning in BOTH builds (TL t/2840 ruling #2), so the
// renderer's "Save as PDF" path (#1305) stays reachable on desktop. brief.html is always among the
// persisted artifacts so the PDF button is never invisible.

import { ipcMain, app } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { runBriefPipeline, type BriefArtifact } from '../../../../lib/brief/pipeline.js';
import { codeForHardFailures } from '../../../../lib/brief/errorMapping.js';
import {
  BRIEF_ARTIFACTS,
  type BriefArtifactName,
  type BriefPreset,
  type ExportJobState,
  type ExportErrorCode,
  type ModelSource,
} from '../../../../lib/brief/types.js';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import type { DebateSession } from '../../../../lib/debate/types.js';
import { ActionableError, errorMessage } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { makeElectronAIAdapter } from '../electronAIAdapter.js';
import { loadDebateSession } from '../debateIO.js';

// Mirrors the server's constant — recorded in the audit manifest.
const TOOL_VERSIONS: Record<string, string> = { node: process.version, brief: '1.0' };
const JOB_TTL_MS = 10 * 60_000;

interface BriefExportRequestBody {
  preset: BriefPreset;
  model?: string;
  /** Provenance hint from the renderer (matches the web AppAPI request). */
  modelSource?: 'global' | 'explicit';
  checkerModel?: string;
  framingMeta?: boolean;
  options?: { skipNarration?: boolean };
  /** Desktop-only: raw .potx bytes passed inline from the renderer (t/2853). */
  template?: Uint8Array;
}

interface BriefRecord {
  exportId: string;
  debateId: string;
  title: string;
  preset: BriefPreset;
  status: 'done' | 'failed';
  errorCode?: ExportErrorCode;
  formats: string[];
  artifacts: BriefArtifactName[];
  traceCoveragePct: number;
  warnings: string[];
  createdAt: string;
}

// ── Job registry (in-process, single-user) ──

interface BriefJob {
  jobId: string;
  debateId: string;
  status: ExportJobState;
  progressPct: number;
  warnings: string[];
  error: string | null;
  errorCode: ExportErrorCode | null;
  exportId: string | null;
  startedAt: number;
}

const jobs = new Map<string, BriefJob>();

const PROGRESS: Record<ExportJobState, number> = {
  queued: 0, extracting: 10, narrating: 30, checking: 50,
  rendering: 70, verifying: 90, done: 100, failed: 100,
};

function setState(job: BriefJob, status: ExportJobState): void {
  job.status = status;
  job.progressPct = PROGRESS[status];
}

function sweepJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if ((j.status === 'done' || j.status === 'failed') && now - j.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// codeForThrow stays caller-local by design (Shared Lib p/18#25): it maps a *stage throw* to a
// stable code — a shell concern, not a pipeline output. Mirrors the T6 server copy.
function codeForThrow(err: unknown, stage: ExportJobState): ExportErrorCode {
  const msg = errorMessage(err).toLowerCase();
  if (msg.includes('closed')) return 'DebateNotClosed';
  if (stage === 'narrating' || stage === 'checking') return 'ModelUnavailable';
  return 'RenderFailure';
}

// ── Filesystem store (single-user; userData/brief-exports) ──

function exportsDir(): string { return path.join(app.getPath('userData'), 'brief-exports'); }
function exportDir(exportId: string): string { return path.join(exportsDir(), `export-${exportId}`); }
const INDEX_FILE = '_index.json';

function readIndex(): BriefRecord[] {
  try { return JSON.parse(fs.readFileSync(path.join(exportsDir(), INDEX_FILE), 'utf-8')) as BriefRecord[]; }
  // eslint-disable-next-line local/require-warn-on-degraded-catch-return -- ENOENT on first run is normal new-user state; [] is the correct baseline, not a degraded fallback
  catch { /* no index yet / unreadable → empty list — silent by design (ADR-003) */ return []; }
}
function writeIndex(recs: BriefRecord[]): void {
  fs.mkdirSync(exportsDir(), { recursive: true });
  fs.writeFileSync(path.join(exportsDir(), INDEX_FILE), JSON.stringify(recs, null, 2), 'utf-8');
}
function upsertIndex(rec: BriefRecord): void {
  const recs = readIndex();
  const i = recs.findIndex(r => r.exportId === rec.exportId);
  if (i >= 0) recs[i] = rec; else recs.push(rec);
  writeIndex(recs);
}

/** Persist an export: write each artifact under export-<id>/, then upsert the index. Called for
 *  BOTH done and failed jobs — a failed export still stores its manifest + record (diagnosable). */
function saveExport(rec: BriefRecord, artifacts: BriefArtifact[]): void {
  const dir = exportDir(rec.exportId);
  fs.mkdirSync(dir, { recursive: true });
  for (const a of artifacts) {
    const p = path.join(dir, a.name);
    if (a.bytes !== undefined) fs.writeFileSync(p, Buffer.from(a.bytes));
    else fs.writeFileSync(p, a.text ?? '', 'utf-8');
  }
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(rec, null, 2), 'utf-8');
  upsertIndex(rec);
}

function listExports(debateId?: string): BriefRecord[] {
  const recs = readIndex();
  return debateId ? recs.filter(r => r.debateId === debateId) : recs;
}

function loadArtifact(exportId: string, name: BriefArtifactName): Uint8Array | null {
  const p = path.join(exportDir(exportId), name);
  // eslint-disable-next-line local/require-warn-on-degraded-catch-return -- ENOENT means the artifact is absent; the IPC handler surfaces 404 to the renderer, so null is the correct route outcome
  try { return fs.readFileSync(p); } catch { /* artifact absent → null (route surfaces not-found) — silent by design (ADR-003) */ return null; }
}

function deleteExport(exportId: string): void {
  fs.rmSync(exportDir(exportId), { recursive: true, force: true });
  const recs = readIndex().filter(r => r.exportId !== exportId);
  writeIndex(recs);
}

// ── Runner ──

function startJob(debateId: string, body: BriefExportRequestBody): BriefJob {
  sweepJobs();
  const job: BriefJob = {
    jobId: randomUUID(),
    debateId,
    status: 'queued',
    progressPct: 0,
    warnings: [],
    error: null,
    errorCode: null,
    exportId: null,
    startedAt: Date.now(),
  };
  jobs.set(job.jobId, job);
  void runJob(job, body);
  return job;
}

async function runJob(job: BriefJob, body: BriefExportRequestBody): Promise<void> {
  const exportId = randomUUID();
  const artifacts: BriefArtifact[] = [];
  let title = job.debateId;
  let traceCoveragePct = 0;
  let stage: ExportJobState = 'extracting';
  try {
    const session = (await loadDebateSession(job.debateId)) as DebateSession | null;
    if (!session) {
      throw new ActionableError({
        goal: 'Export a debate brief (desktop)',
        problem: `Debate "${job.debateId}" was not found`,
        location: 'briefExportHandlers runJob',
        nextSteps: ['Open the debate in the app and try again'],
      });
    }

    // Desktop has no entitlement gate — use the requested model directly (or the app default).
    const result = await runBriefPipeline(
      {
        session,
        preset: body.preset,
        skipNarration: body.options?.skipNarration === true,
        modelId: body.model || DEFAULT_MODEL,
        // Map the request hint → resolved provenance (mirrors the web route's resolveExportModel):
        // no model asked → Default; explicit ask → Global (use-current) or Explicit.
        modelSource: (!body.model ? 'Default' : body.modelSource === 'global' ? 'Global' : 'Explicit') as ModelSource,
        checkerModelId: body.checkerModel || undefined,
        checkerModelSource: body.checkerModel ? ('Explicit' as ModelSource) : undefined,
        framingMeta: body.framingMeta === false ? false : undefined,
        template: body.template,
        // No allowOpen on desktop v1 — parity is closed-debate export (the GUI gates to closed).
        toolVersions: TOOL_VERSIONS,
        timestamp: new Date().toISOString(),
      },
      makeElectronAIAdapter(),
      (s) => { setState(job, s); stage = s; },
      (a: BriefArtifact) => { artifacts.push(a); },
    );

    title = result.spec.meta.title;
    job.warnings.push(...result.warnings);
    traceCoveragePct = result.manifest.trace_coverage_pct;

    const hardFailures = result.hardFailures;
    const status: 'done' | 'failed' = hardFailures.length > 0 ? 'failed' : 'done';
    const errorCode = hardFailures.length > 0 ? codeForHardFailures(hardFailures) : undefined;

    persistRecord(exportId, job, status, title, body.preset, traceCoveragePct, errorCode, artifacts);

    if (status === 'failed') {
      job.error = `Export verify gate failed: ${hardFailures.join('; ')}`;
      job.errorCode = errorCode ?? null;
      setState(job, 'failed');
    } else {
      job.exportId = exportId;
      setState(job, 'done');
    }
  } catch (err) {
    // A stage threw — persist whatever artifacts were captured (onArtifact) so the failure is
    // diagnosable, then mark failed with the mapped code.
    const errorCode = codeForThrow(err, stage);
    job.error = errorMessage(err);
    job.errorCode = errorCode;
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'brief-export-desktop', level: 'error',
      message: `Desktop brief export failed at ${stage}`,
      error: { name: (err as Error).name ?? 'Error', message: job.error, stack: (err as Error).stack },
    });
    try {
      persistRecord(exportId, job, 'failed', title, body.preset, traceCoveragePct, errorCode, artifacts);
    } catch (perr) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'brief-export-desktop', level: 'error',
        message: 'Desktop brief export failure-record persist also failed',
        error: { name: (perr as Error).name ?? 'Error', message: errorMessage(perr) },
      });
    }
    setState(job, 'failed');
  }
}

function persistRecord(
  exportId: string, job: BriefJob, status: 'done' | 'failed', title: string, preset: BriefPreset,
  traceCoveragePct: number, errorCode: ExportErrorCode | undefined, artifacts: BriefArtifact[],
): void {
  const names = artifacts.map(a => a.name);
  const rec: BriefRecord = {
    exportId, debateId: job.debateId, title, preset, status, errorCode,
    formats: [
      ...(names.includes(BRIEF_ARTIFACTS.pptx) ? ['pptx'] : []),
      ...(names.includes(BRIEF_ARTIFACTS.htmlDoc) ? ['html'] : []),
    ],
    artifacts: names,
    traceCoveragePct,
    warnings: job.warnings,
    createdAt: new Date().toISOString(),
  };
  saveExport(rec, artifacts);
}

// ── IPC registration ──

export function registerBriefExportHandlers(): void {
  ipcMain.handle('create-brief-export', (_event, debateId: string, body: BriefExportRequestBody) => {
    if (!body?.preset) {
      throw new ActionableError({
        goal: 'Start a brief export (desktop)',
        problem: 'A preset is required',
        location: 'briefExportHandlers create-brief-export',
        nextSteps: ['Pick a preset (policymaker / conference / classroom) and retry'],
      });
    }
    const job = startJob(debateId, body);
    return { jobId: job.jobId };
  });

  ipcMain.handle('get-brief-export-job', (_event, jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) {
      throw new ActionableError({
        goal: 'Check a brief export job (desktop)',
        problem: `Export job "${jobId}" not found (it may have expired)`,
        location: 'briefExportHandlers get-brief-export-job',
        nextSteps: ['Re-check the debate exports list', 'Start the export again'],
      });
    }
    return {
      status: job.status,
      progressPct: job.progressPct,
      warnings: job.warnings,
      error: job.error,
      errorCode: job.errorCode,
      exportId: job.exportId,
    };
  });

  ipcMain.handle('list-brief-exports', (_event, debateId: string) => listExports(debateId));

  ipcMain.handle('download-brief-artifact', (_event, exportId: string, name: BriefArtifactName) => {
    // Returns raw bytes; the renderer/electron-bridge wraps them into a Blob (Blob-returning AppAPI
    // in both builds — TL ruling #2). null → the bridge surfaces a not-found error.
    return loadArtifact(exportId, name);
  });

  ipcMain.handle('delete-brief-export', (_event, exportId: string) => {
    deleteExport(exportId);
  });
}
