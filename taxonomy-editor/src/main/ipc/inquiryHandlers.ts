// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry — Electron main-process job runner (t/3579). Runs the SHARED lib/debate
// `runInquiryPipeline` (t/3585) in-process, mirroring `briefExportHandlers.ts`'s local
// job-Map pattern (t/2840) minus the server-only concerns: desktop is single-user, so
// there is no auth gate, no per-user quota, no rate limiting, and no cross-replica
// persistence fallback (`server/inquiryJobs.ts`/`storage/inquiryResultStore.ts`, t/3578) —
// a single in-memory Map is the complete, durable-enough store for one desktop process.
//
// `status`/`terminationReason`/`resultId`/`error` field names and the terminal
// done/done_truncated/failed vocabulary mirror the server's InquiryStatusResponse
// (t/3578, ServerAPI's inquiryJobs.ts) exactly — Rosetta Stone's bridge (t/3582) polls
// both builds through the same shape. `InquiryJobStatus`, `isTerminalStatus`, and
// `deriveTruncation` are the canonical hoisted symbols from lib/inquiry (t/3609) — no
// local duplicates.

import { ipcMain } from 'electron';
import { randomUUID } from 'crypto';
import { PROJECT_ROOT, readTaxonomyFile } from '../fileIO.js';
import { computeEmbeddings } from '../embeddings.js';
import { makeElectronAIAdapter } from '../electronAIAdapter.js';
import { assembleNodeEmbeddings, type NodeEmbeddingMap } from '../../../../lib/debate/relevanceSelection.js';
import type { GroundingTaxonomy } from '../../../../lib/debate/inquiryGrounding.js';
import { runInquiryPipeline, type InquiryPipelineDeps, type InquiryStage } from '../../../../lib/debate/inquiryPipeline.js';
import { runHeadlessDebate } from '../../../../lib/debate/headlessRunner.js';
import { loadTaxonomy, type LoadedTaxonomy } from '../../../../lib/debate/taxonomyLoader.js';
import { loadModelRegistry } from '../../../../lib/ai-client/registry.js';
import {
  InquiryRequestSchema, type InquiryRequest, type InquiryResult,
  type InquiryJobStatus, isTerminalStatus, deriveTruncation,
} from '../../../../lib/inquiry/index.js';
import { errorMessage } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

const JOB_TTL_MS = 30 * 60_000; // matches server's INQUIRY_JOB_TTL_MS (t/3578#6) — deep fidelity can run ~45 min

interface InquiryJob {
  jobId: string;
  status: InquiryJobStatus;
  progressPct: number;
  terminationReason: string | null;
  resultId: string | null;
  error: string | null;
  result: InquiryResult | null;
  startedAt: number;
}

const jobs = new Map<string, InquiryJob>();

const PROGRESS: Record<InquiryJobStatus, number> = {
  queued: 0, grounding: 10, debating: 40, judging: 70, synthesizing: 90,
  done: 100, done_truncated: 100, failed: 100,
};

function setStatus(job: InquiryJob, status: InquiryJobStatus): void {
  job.status = status;
  job.progressPct = PROGRESS[status];
}

function sweepJobs(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (isTerminalStatus(j.status) && now - j.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

// Map the pipeline's stage vocabulary (deriving/grounding/debating/projecting/synthesizing) onto the
// job's coarser status set — mirrors server inquiryPipelineDeps.ts's mapStage exactly.
function mapStage(stage: InquiryStage): InquiryJobStatus {
  switch (stage) {
    case 'deriving':
    case 'grounding': return 'grounding';
    case 'debating': return 'debating';
    case 'projecting': return 'judging';
    case 'synthesizing': return 'synthesizing';
    default: { const _x: never = stage; return _x; }
  }
}

// ── Grounding taxonomy (Electron-local corpus read) ──
//
// readTaxonomyFile only serves accelerationist/safetyist/skeptic (main process convention —
// see ipc/taxonomyHandlers.ts's POV_FILE_KEYS); unlike the server's getAssembledCorpus, there
// is no separate 'cross-cutting' pov file to read here. The cc camp's GroundingEnvelope entry
// stays empty from this build (nodesByCamp is a PARTIAL record by design, ADR-001) — the
// situationNodes (read via readTaxonomyFile('situations'), which itself falls back to
// cross-cutting.json) still populate the anchor-situation selection.
const POV_FILES = ['accelerationist', 'safetyist', 'skeptic'] as const;

async function buildGroundingTaxonomy(): Promise<GroundingTaxonomy> {
  const povNodes: GroundingTaxonomy['povNodes'] = [];
  const nodeEmbeddings: NodeEmbeddingMap = {};
  const sitFile = readTaxonomyFile('situations') as { nodes?: GroundingTaxonomy['situationNodes'] } | null;
  const situationNodes = sitFile?.nodes ?? [];
  const embed = (texts: string[], ids?: string[]): Promise<number[][]> => computeEmbeddings(texts, ids);

  for (const pov of POV_FILES) {
    try {
      const file = readTaxonomyFile(pov) as { nodes?: GroundingTaxonomy['povNodes'] } | null;
      const nodes = file?.nodes ?? [];
      povNodes.push(...nodes);
      const { nodeEmbeddings: povEmbeddings } = await assembleNodeEmbeddings(pov, nodes, [], embed, null);
      Object.assign(nodeEmbeddings, povEmbeddings);
    } catch (err) {
      // A missing/unreadable pov file degrades to skipping that camp's nodes (envelope is
      // partial over camps by design) — WARN so the degradation is visible (root AGENTS.md).
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'inquiry-desktop', level: 'warn',
        message: `Grounding taxonomy: pov '${pov}' unreadable — skipped`,
        error: { name: (err as Error).name ?? 'Error', message: errorMessage(err) },
      });
    }
  }
  return { povNodes, situationNodes, nodeEmbeddings };
}

// Main-branch taxonomy is immutable at runtime within a single desktop session — memoize
// rather than re-reading per inquiry (mirrors server's getLoadedTaxonomy, t/3581).
let _loadedTaxonomy: LoadedTaxonomy | null = null;
function getLoadedTaxonomy(): LoadedTaxonomy {
  if (_loadedTaxonomy === null) _loadedTaxonomy = loadTaxonomy(PROJECT_ROOT);
  return _loadedTaxonomy;
}

// ── Job creation + async runner ──

function startJob(request: InquiryRequest): InquiryJob {
  sweepJobs();
  const job: InquiryJob = {
    jobId: randomUUID(),
    status: 'queued',
    progressPct: 0,
    terminationReason: null,
    resultId: null,
    error: null,
    result: null,
    startedAt: Date.now(),
  };
  jobs.set(job.jobId, job);
  void runJob(job, request);
  return job;
}

async function runJob(job: InquiryJob, request: InquiryRequest): Promise<void> {
  try {
    const adapter = makeElectronAIAdapter('Inquiry');
    const deps: InquiryPipelineDeps = {
      registry: loadModelRegistry(PROJECT_ROOT),
      taxonomy: await buildGroundingTaxonomy(),
      embed: (texts: string[]) => computeEmbeddings(texts),
      runDebate: (config, _question) => runHeadlessDebate(config, adapter, getLoadedTaxonomy())
        .then(r => ({ session: r.session, terminationReason: r.terminationReason })),
      adapter,
      onStage: (stage: InquiryStage) => setStatus(job, mapStage(stage)),
    };
    const result = await runInquiryPipeline(request, deps);

    const { truncated, terminationReason } = deriveTruncation(result);
    job.result = result;
    job.resultId = job.jobId;
    job.terminationReason = terminationReason ?? null;
    setStatus(job, truncated ? 'done_truncated' : 'done');
  } catch (err) {
    job.error = errorMessage(err);
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'inquiry-desktop', level: 'error',
      message: `Desktop inquiry job failed at ${job.status}`,
      error: { name: (err as Error).name ?? 'Error', message: job.error, stack: (err as Error).stack },
    });
    setStatus(job, 'failed');
  } finally {
    job.startedAt = Date.now(); // restart the TTL clock from the terminal state
  }
}

/** The poll view — matches Rosetta Stone's InquiryStatusResponse field names verbatim (t/3582#2). */
function jobView(job: InquiryJob): Record<string, unknown> {
  const base = {
    jobId: job.jobId,
    status: job.status,
    progressPct: job.progressPct,
    terminationReason: job.terminationReason,
    resultId: job.resultId,
    error: job.error,
  };
  return job.result ? { ...base, result: job.result } : base;
}

// ── IPC registration ──

export function registerInquiryHandlers(): void {
  ipcMain.handle('start-inquiry', (_event, request: unknown): { jobId: string } => {
    const parsed = InquiryRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new Error('Invalid inquiry request: ' + parsed.error.message);
    }
    const job = startJob(parsed.data);
    return { jobId: job.jobId };
  });

  ipcMain.handle('get-inquiry', (_event, jobId: string): Record<string, unknown> | null => {
    const job = jobs.get(jobId);
    return job ? jobView(job) : null;
  });
}
