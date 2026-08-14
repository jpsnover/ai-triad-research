// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Op-ed create/cancel/export IPC handlers (t/2575, t/2588, t/2611).
// Stage A: Get-OpEdSource PS shim hoisted once per create call (FromUrl path).
// Stage B: lib/oped generate.ts in-process core — parallel voice fan-out via AIAdapter.
// Partial-set contract: failed/cancelled members persisted; whole-set Markdown export.

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { ActionableError } from '../../../../lib/debate/errors.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { assertSafeId } from '../../../../lib/electron-shared/safeId.js';
import { PROJECT_ROOT, getDataRootPath } from '../fileIO.js';
import { saveOpEdSetTemp, finalizeOpEdSet, loadOpEdSet, deleteOpEdSet, listOpEdSets, saveOpEdSet } from '../opedIO.js';
import type { OpEdSet, OpEdMember, OpEdParams } from '../../../../lib/oped/types.js';
import type { PovKey } from '../../../../lib/oped/types.js';
import { generateOpEdSet } from '../../../../lib/oped/generate.js';
import type { GenerateOpEdRequest, OpEdGeneratorDeps } from '../../../../lib/oped/generate.js';
import { makeElectronAIAdapter } from '../electronAIAdapter.js';

// Shared prompts dir: op-ed-*.prompt artifacts (relocated to lib/oped/prompts by t/2609).
const PROMPTS_DIR = path.join(PROJECT_ROOT, 'lib', 'oped', 'prompts');

// Stage-A fetch shim (FromUrl path only — stays PS, t/2604 P2 will migrate to TS).
const PREP_SHIM_PATH = path.join(PROJECT_ROOT, 'taxonomy-editor', 'src', 'main', 'ps', 'invoke-get-oped-source.ps1');

// Read generation.opedVoiceTimeoutMs from {dataRoot}/admin/runtime-config.json on each run.
// Falls back to 360s — in-process generation matches the PS wall-clock for grounding + LLM.
function getVoiceTimeoutMs(): number {
  try {
    const cfgPath = path.join(getDataRootPath(), 'admin', 'runtime-config.json');
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    const g = raw.generation as Record<string, unknown> | undefined;
    const val = Number(g?.opedVoiceTimeoutMs);
    if (Number.isFinite(val) && val >= 60_000 && val <= 3_600_000) return val;
  } catch { /* telemetry — silent by design */ }
  return 360_000;
}

// ── Active run registry ───────────────────────────────────────────────────────

const activeOpEdRuns = new Map<string, AbortController>();

// ── IPC progress event shape ──────────────────────────────────────────────────

type OpEdStage = 'queued' | 'preparing-source' | 'fetching' | 'grounding' | 'generating' | 'finalizing' | 'complete' | 'failed' | 'cancelled';

interface OpEdProgressEvent {
  set_id: string;
  voice?: PovKey;  // absent for set-phase events (e.g. preparing-source, grounding)
  stage: OpEdStage;
  error?: string;
}

// ── Shim stdout line shapes (Stage-A only) ────────────────────────────────────

interface ShimStageLine { type: 'stage'; stage: string }
interface ShimResultLine { type: 'result'; data: Record<string, unknown> }
type ShimLine = ShimStageLine | ShimResultLine;

// ── Stage-A: source prep runner ───────────────────────────────────────────────

function runGetOpEdSource(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', PREP_SHIM_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    function onAbort(): void {
      settle(() => { child.kill('SIGTERM'); reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); });
    }

    function settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      signal.removeEventListener('abort', onAbort);
      fn();
    }

    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });

    timeoutHandle = setTimeout(() => {
      settle(() => { child.kill('SIGTERM'); reject(new Error('Get-OpEdSource timed out')); });
    }, getVoiceTimeoutMs());

    child.stdin.write(JSON.stringify({ Url: url }), 'utf-8');
    child.stdin.end();

    let stdoutBuf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: ShimLine;
        try { msg = JSON.parse(trimmed) as ShimLine; } catch { /* telemetry — silent by design */ continue; }
        if (msg.type === 'result') {
          settle(() => resolve((msg as ShimResultLine).data ?? {}));
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'opedHandlers', level: 'warn',
        message: `Get-OpEdSource stderr: ${chunk.toString('utf-8').slice(0, 500)}`,
      });
    });

    child.on('error', (err) => settle(() => reject(err)));
    child.on('close', (code) => settle(() => {
      if (code !== 0) reject(new Error(`Get-OpEdSource exited with code ${code}`));
      else reject(new Error('No result received from Get-OpEdSource'));
    }));
  });
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderOpEdSetMarkdown(set: OpEdSet): string {
  const lines: string[] = [
    `# Op-Ed Set: ${set.topic}`,
    '',
    `*Generated: ${set.created_at}*`,
    '',
  ];
  for (const member of set.opeds) {
    if (member.status !== 'complete') {
      lines.push(`## ${member.pov} — ${member.status}`, '');
      continue;
    }
    lines.push(`## ${member.pov}`, '', `### ${member.headline}`);
    if (member.subtitle) lines.push('', `*${member.subtitle}*`);
    lines.push('', member.body);
    if (member.pitch) lines.push('', '**Pitch:**', '', member.pitch);
    if (member.grounding?.length) {
      lines.push('', '**Grounding:**', '');
      for (const g of member.grounding) {
        lines.push(`- ${g.label} (${g.pov}): ${g.how_reflected}`);
      }
    }
    lines.push('', '---', '');
  }
  return lines.join('\n');
}

// ── Handler registration ──────────────────────────────────────────────────────

export function registerOpEdHandlers(): void {
  ipcMain.handle('create-oped-set', async (event, payload: {
    topic: string;
    url?: string;   // if provided, Get-OpEdSource is hoisted once (Stage A) before generation
    params: OpEdParams;
    voices: PovKey[];
  }) => {
    const { topic, url, params, voices } = payload;

    if (!topic?.trim() || !voices?.length) {
      throw new ActionableError({
        goal: 'Create op-ed set',
        problem: 'topic and at least one voice are required',
        location: 'opedHandlers create-oped-set',
        nextSteps: ['Provide a topic and select at least one voice'],
      });
    }

    const setId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const controller = new AbortController();
    activeOpEdRuns.set(setId, controller);

    const send = (data: OpEdProgressEvent): void => {
      if (!event.sender.isDestroyed()) event.sender.send('oped-progress', data);
    };

    // Stage A: hoist Get-OpEdSource once before generation (FromUrl path).
    // Fail fast if readability gate trips — don't fan out to draft on garbage (TL cond 3).
    let sourceBrief: string | undefined;
    if (url) {
      send({ set_id: setId, stage: 'preparing-source' });
      try {
        const sourcePrep = await runGetOpEdSource(url, controller.signal);
        // Extract markdown text for the lib/oped sourceBrief slot ({{SOURCE_MATERIAL}}).
        // Structured fields (SOURCE_AUTHOR etc.) are P2 — empty in P1 (t/2604).
        sourceBrief = sourcePrep.SourceMarkdown != null ? String(sourcePrep.SourceMarkdown) : undefined;
      } catch (err) {
        activeOpEdRuns.delete(setId);
        getGlobalRecorder()?.record({
          type: 'system.error', component: 'opedHandlers', level: 'error',
          message: `Stage A Get-OpEdSource failed for set ${setId}: ${(err as Error).message}`,
          error: { name: (err as Error).name ?? 'Error', message: String((err as Error).message ?? err), stack: (err as Error).stack },
        });
        throw new ActionableError({
          goal: 'Prepare source material for op-ed set',
          problem: `Get-OpEdSource failed: ${(err as Error).message}`,
          location: 'opedHandlers create-oped-set Stage A',
          nextSteps: [
            'Check that the URL is publicly accessible',
            'Verify the page contains sufficient readable text (minimum word count required)',
          ],
        });
      }
    }

    // Fire queued for each voice — renderer stores set_id for cancellation
    for (const voice of voices) {
      send({ set_id: setId, voice, stage: 'queued' });
    }

    const request: GenerateOpEdRequest = {
      set_id: setId,
      topic,
      params,
      povs: voices,
      sourceBrief,
      signal: controller.signal,
    };

    const deps: OpEdGeneratorDeps = {
      adapter: makeElectronAIAdapter(getVoiceTimeoutMs()),
      promptsDir: PROMPTS_DIR,
      repoRoot: PROJECT_ROOT,
    };

    const completedMembers: OpEdMember[] = [];
    let finalized = false;

    try {
      for await (const evt of generateOpEdSet(request, deps)) {
        switch (evt.type) {
          case 'grounding_done':
            send({ set_id: setId, stage: 'grounding' });
            break;
          case 'grounding_failed':
            getGlobalRecorder()?.record({
              type: 'system.error', component: 'opedHandlers', level: 'warn',
              message: `Grounding failed for set ${setId}: ${evt.error} — continuing voice-only`,
            });
            break;
          case 'voice_start':
            send({ set_id: setId, voice: evt.pov, stage: 'generating' });
            break;
          case 'voice_complete': {
            completedMembers.push(evt.member);
            try {
              saveOpEdSetTemp({ schema_version: 1, set_id: setId, topic, params, created_at: createdAt, opeds: [...completedMembers] });
            } catch { /* telemetry — silent by design; temp save is best-effort */ }
            send({ set_id: setId, voice: evt.pov, stage: 'complete' });
            break;
          }
          case 'voice_failed': {
            const failed: OpEdMember = { pov: evt.pov, status: 'failed', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] };
            completedMembers.push(failed);
            send({ set_id: setId, voice: evt.pov, stage: 'failed', error: evt.error });
            break;
          }
          case 'voice_cancelled': {
            const cancelled: OpEdMember = { pov: evt.pov, status: 'cancelled', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] };
            completedMembers.push(cancelled);
            send({ set_id: setId, voice: evt.pov, stage: 'cancelled' });
            break;
          }
          case 'complete':
            finalizeOpEdSet(evt.set);
            finalized = true;
            break;
        }
      }
    } finally {
      activeOpEdRuns.delete(setId);
      // Abort before complete: persist partial set so completed voices aren't lost.
      if (!finalized && completedMembers.length > 0) {
        try {
          finalizeOpEdSet({ schema_version: 1, set_id: setId, topic, params, created_at: createdAt, opeds: completedMembers });
        } catch { /* telemetry — silent by design */ }
      }
    }

    return { set_id: setId };
  });

  ipcMain.handle('cancel-oped-set', (_event, setId: string) => {
    activeOpEdRuns.get(setId)?.abort();
  });

  ipcMain.handle('list-oped-sets', () => listOpEdSets());

  ipcMain.handle('load-oped-set', (_event, setId: string) => {
    assertSafeId(setId, 'oped set id');
    return loadOpEdSet(setId);
  });

  ipcMain.handle('delete-oped-set', (_event, setId: string) => {
    assertSafeId(setId, 'oped set id');
    deleteOpEdSet(setId);
  });

  ipcMain.handle('save-oped-set', (_event, set: OpEdSet) => {
    assertSafeId(set.set_id, 'oped set id');
    saveOpEdSet(set);
  });

  ipcMain.handle('export-oped-set', async (event, setId: string) => {
    assertSafeId(setId, 'oped set id');

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { cancelled: true };

    let set: OpEdSet;
    try {
      set = loadOpEdSet(setId);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'opedHandlers', level: 'error',
        message: `export-oped-set: set not found (${setId})`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      throw new ActionableError({
        goal: `Export op-ed set ${setId}`,
        problem: 'Op-ed set file not found',
        location: 'opedHandlers export-oped-set',
        nextSteps: ['Verify the set was created successfully before exporting'],
      });
    }

    const slug = set.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 60);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Op-Ed Set',
      defaultPath: `oped-${slug}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled || !result.filePath) return { cancelled: true };

    fs.writeFileSync(result.filePath, renderOpEdSetMarkdown(set), 'utf-8');
    return { cancelled: false, filePath: result.filePath };
  });
}
