// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Op-ed create/cancel/export IPC handlers (t/2575, t/2588).
// Stage A: Get-OpEdSource hoisted once per create call, SourcePrep threaded into each voice.
// Stage B: N× New-OpEd fan-out via ElectronMain-owned PS shim, per-voice progress + cancel.
// Partial-set contract: failed/cancelled members; whole-set Markdown export.

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

// PS shims live in source tree alongside their TypeScript callers. PROJECT_ROOT resolves
// via resolveRepoRootForApp (walks .aitriad.json), stable in both dev and packaged builds —
// build:main is tsc-only and does not copy .ps1 to dist/.
const SHIM_PATH      = path.join(PROJECT_ROOT, 'taxonomy-editor', 'src', 'main', 'ps', 'invoke-oped.ps1');
const PREP_SHIM_PATH = path.join(PROJECT_ROOT, 'taxonomy-editor', 'src', 'main', 'ps', 'invoke-get-oped-source.ps1');

// Read generation.opedVoiceTimeoutMs from {dataRoot}/admin/runtime-config.json on each run
// so it's tunable without restart. Falls back to 360s (New-OpEd = grounding + full-essay LLM;
// debate briefs use 330s — 30s was mock-friendly but fails real runs).
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

// ── Active run registry (keyed by set_id — sent in queued events so renderer can cancel early)

const activeOpEdRuns = new Map<string, AbortController>();

// ── Progress event shape ──────────────────────────────────────────────────────

type OpEdStage = 'queued' | 'preparing-source' | 'fetching' | 'grounding' | 'generating' | 'finalizing' | 'complete' | 'failed' | 'cancelled';

interface OpEdProgressEvent {
  set_id: string;
  voice?: PovKey;  // absent for set-phase events (e.g. preparing-source)
  stage: OpEdStage;
  error?: string;
}

// ── Shim stdout line shapes ───────────────────────────────────────────────────

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

// ── Stage-B: single-voice runner ─────────────────────────────────────────────

interface VoiceRunOpts {
  topic: string;
  pov: PovKey;
  params: OpEdParams;
  sourcePrep?: Record<string, unknown>;  // hoisted Stage-A result; if absent, Url falls through
  signal: AbortSignal;
  onProgress: (stage: OpEdStage, error?: string) => void;
}

function runVoice({ topic, pov, params, sourcePrep, signal, onProgress }: VoiceRunOpts): Promise<OpEdMember> {
  return new Promise<OpEdMember>((resolve, reject) => {
    const stdinPayload = JSON.stringify({
      Topic: topic,
      Pov: pov,
      WordCount: params.wordCount,
      Model: params.model,
      // SourcePrep (FromPrep path) and Url (FromUrl path) are mutually exclusive parameter sets.
      // The orchestrator passes SourcePrep when it has hoisted Stage A; otherwise falls through
      // to Url for single-voice direct callers (not currently wired — future use).
      ...(sourcePrep
        ? { SourcePrep: sourcePrep }
        : {}),
      ...(params.outlet    ? { Outlet:    params.outlet }    : {}),
      ...(params.newsHook  ? { NewsHook:  params.newsHook }  : {}),
      ...(params.thesis    ? { Thesis:    params.thesis }    : {}),
      ...(params.authorBio ? { AuthorBio: params.authorBio } : {}),
    });

    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', SHIM_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const voiceTimeoutMs = getVoiceTimeoutMs();

    function onAbort(): void {
      settle(() => {
        child.kill('SIGTERM');
        onProgress('cancelled');
        reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      });
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
      settle(() => {
        child.kill('SIGTERM');
        onProgress('failed', 'timeout');
        reject(new Error(`Voice ${pov} timed out after ${voiceTimeoutMs}ms`));
      });
    }, voiceTimeoutMs);

    child.stdin.write(stdinPayload, 'utf-8');
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
        if (msg.type === 'stage') {
          onProgress(msg.stage as OpEdStage);
        } else if (msg.type === 'result') {
          const raw = msg.data ?? {};
          const member: OpEdMember = {
            pov,
            status: 'complete',
            headline:  String(raw.Headline  ?? raw.headline  ?? ''),
            subtitle:  String(raw.Subtitle  ?? raw.subtitle  ?? ''),
            body:      String(raw.Body      ?? raw.body      ?? ''),
            pitch:     raw.Pitch ?? raw.pitch ? String(raw.Pitch ?? raw.pitch) : undefined,
            wordCount: Number(raw.WordCount  ?? raw.wordCount ?? 0),
            grounding: Array.isArray(raw.Grounding ?? raw.grounding)
              ? (raw.Grounding ?? raw.grounding) as OpEdMember['grounding']
              : [],
          };
          settle(() => {
            onProgress('complete');
            resolve(member);
          });
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'opedHandlers', level: 'warn',
        message: `Voice stderr (${pov}): ${chunk.toString('utf-8').slice(0, 500)}`,
      });
    });

    child.on('error', (err) => {
      settle(() => {
        onProgress('failed', err.message);
        reject(err);
      });
    });

    child.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          onProgress('failed', `exit ${code ?? 'null'}`);
          reject(new Error(`pwsh exited with code ${code} for voice ${pov}`));
        } else {
          onProgress('failed', 'no result line received');
          reject(new Error(`No result received from voice ${pov}`));
        }
      });
    });
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
    url?: string;   // if provided, Get-OpEdSource is hoisted once (Stage A) before voice fan-out
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

    // Stage A: hoist Get-OpEdSource once before spawning voices.
    // Fail fast if readability gate trips — don't fan out to draft on garbage (TL cond 3).
    let sourcePrep: Record<string, unknown> | undefined;
    if (url) {
      send({ set_id: setId, stage: 'preparing-source' });
      try {
        sourcePrep = await runGetOpEdSource(url, controller.signal);
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

    const completedMembers: OpEdMember[] = [];

    const voicePromises = voices.map(async (voice): Promise<OpEdMember> => {
      const member = await runVoice({
        topic, pov: voice, params, sourcePrep,
        signal: controller.signal,
        onProgress: (stage, error) => send({ set_id: setId, voice, stage, error }),
      }).catch((err): OpEdMember => {
        const isAbort = (err as Error).name === 'AbortError' || String((err as Error).message) === 'cancelled';
        return { pov: voice, status: isAbort ? 'cancelled' : 'failed', headline: '', subtitle: '', body: '', wordCount: 0, grounding: [] };
      });

      completedMembers.push(member);
      // Best-effort temp save after each voice (partial-set crash guard)
      try {
        saveOpEdSetTemp({ schema_version: 1, set_id: setId, topic, params, created_at: createdAt, opeds: [...completedMembers] });
      } catch { /* telemetry — silent by design; temp save is best-effort */ }

      return member;
    });

    try {
      const results = await Promise.all(voicePromises);
      const set: OpEdSet = { schema_version: 1, set_id: setId, topic, params, created_at: createdAt, opeds: results };
      finalizeOpEdSet(set);
      return { set_id: setId };
    } finally {
      activeOpEdRuns.delete(setId);
    }
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
