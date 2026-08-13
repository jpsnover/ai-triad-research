// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Debate handlers (t/1689 split of ipcHandlers.ts, ADR-007).
// Debate session/comment persistence, news-report generation, evidence QBAF,
// debate export (md/txt/pdf/zip), and the harvest write-back handlers.
// Handler bodies moved verbatim; channel names unchanged.

import { ipcMain, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  listDebateSessions,
  loadDebateSession,
  saveDebateSession,
  deleteDebateSession,
  loadDebateComments,
  saveDebateComments,
} from '../debateIO.js';
import { debateToText, debateToMarkdown, debateToPdf, debateToPackage } from '../debateExport.js';
import { getDataRootPath, loadDataConfig, getSourcesDir } from '../fileIO.js';
import { generateText } from '../embeddings.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { renameSyncWithRetry } from '../../../../lib/debate/persistence.js';
import { recordLockHolder } from '../../../../lib/debate/lockHolder.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';
import { DEFAULT_MODEL } from '../../../../lib/ai-client/index.js';
import { VALID_POV, NodeId } from '../ipcSchemas.js';
import { assertSafeId } from '../../../../lib/electron-shared/safeId.js';

export function registerDebateHandlers(): void {
  // ── Debate session handlers ────────────────────────────
  ipcMain.handle('list-debate-sessions', () => {
    return listDebateSessions();
  });

  ipcMain.handle('load-debate-session', (_event, id: string) => {
    return loadDebateSession(id);
  });

  ipcMain.handle('save-debate-session', (_event, session: unknown, caller: string) => {
    saveDebateSession(session, caller);
  });

  ipcMain.handle('delete-debate-session', (_event, id: string) => {
    deleteDebateSession(id);
  });

  ipcMain.handle('load-debate-comments', (_event, debateId: string) => {
    return loadDebateComments(debateId);
  });

  ipcMain.handle('save-debate-comments', (_event, debateId: string, data: unknown) => {
    saveDebateComments(debateId, data);
  });

  ipcMain.handle('generate-news-report', async (_event, debateId: string) => {
    const session = await loadDebateSession(debateId) as Record<string, unknown>;
    const transcript = (session.transcript ?? []) as Array<{ type: string; content: string; speaker: string }>;
    const hasSynthesis = transcript.some(e => e.type === 'synthesis' || e.type === 'concluding');
    if (!hasSynthesis) {
      throw new ActionableError({
        goal: 'Generate news report from debate',
        problem: 'No synthesis entry found in the debate transcript',
        location: 'ipcHandlers.generateNewsReport',
        nextSteps: ['Run synthesis before generating the news report'],
      });
    }

    const { extractTranscriptHighlights, summarizeArgumentNetwork } = await import('../../../../lib/debate/newsReport.js');
    const { newsReportPrompt } = await import('../../../../lib/debate/prompts.js');

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
    const text = await generateText(prompt, undefined, undefined, 120_000);
    return { article: text };
  });

  // ── Evidence QBAF (runs full pipeline in main process) ──
  ipcMain.handle('run-evidence-qbaf', async (_event, claimText: string, claimId: string, model?: string) => {
    const sourcesDir = getSourcesDir();
    if (!sourcesDir || !fs.existsSync(sourcesDir)) return null;

    try {
      const { retrieveEvidence } = await import('../../../../lib/debate/evidenceRetriever.js');
      const { buildEvidenceQbaf } = await import('../../../../lib/debate/evidenceQbaf.js');
      type AIAdapter = import('../../../../lib/debate/aiAdapter.js').AIAdapter;

      const evidenceItems = retrieveEvidence(claimText, sourcesDir, { topK: 10 });
      if (evidenceItems.length === 0) return null;

      const adapter: AIAdapter = {
        generateText: async (prompt: string, mdl: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => {
          return generateText(prompt, mdl, undefined, opts?.timeoutMs, opts?.temperature);
        },
      };

      const evalModel = model || DEFAULT_MODEL;
      const result = await buildEvidenceQbaf(claimText, evidenceItems, adapter, evalModel, {
        claimBaseStrength: 0.5,
      });
      return { ...result, claim_id: claimId };
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'ipc-handlers',
        level: 'error',
        message: 'Operation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] run-evidence-qbaf failed for ${claimId}: ${msg}`);
      return null;
    }
  });

  ipcMain.handle('export-debate-to-file', async (event, session: unknown, format?: string, exportOptions?: { includeTaxonomyRefs?: boolean; includeReasoning?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { cancelled: true };

    const data = session as { title?: string };
    const defaultName = (data.title || 'debate')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 60);

    // Map format to default extension for the save dialog
    const formatExtMap: Record<string, string> = { json: 'json', markdown: 'md', text: 'txt', pdf: 'pdf', package: 'zip' };
    const defaultExt = formatExtMap[format || 'json'] || 'json';

    // Put the requested format first in the filter list
    const allFilters = [
      { name: 'JSON', extensions: ['json'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Plain Text', extensions: ['txt'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Package (ZIP)', extensions: ['zip'] },
    ];
    const selectedIdx = allFilters.findIndex(f => f.extensions[0] === defaultExt);
    const filters = selectedIdx > 0
      ? [allFilters[selectedIdx], ...allFilters.filter((_, i) => i !== selectedIdx)]
      : allFilters;

    const result = await dialog.showSaveDialog(win, {
      title: 'Export Debate',
      defaultPath: `${defaultName}.${defaultExt}`,
      filters,
    });

    if (result.canceled || !result.filePath) {
      return { cancelled: true };
    }

    const fs = await import('fs');
    const filePath = result.filePath;
    const ext = filePath.split('.').pop()?.toLowerCase() || 'json';

    const debate = session as any;

    switch (ext) {
      case 'md': {
        const md = debateToMarkdown(debate, exportOptions);
        fs.writeFileSync(filePath, md, 'utf-8');
        break;
      }
      case 'txt': {
        const txt = debateToText(debate, exportOptions);
        fs.writeFileSync(filePath, txt, 'utf-8');
        break;
      }
      case 'pdf': {
        const pdfBuffer = await debateToPdf(debate, exportOptions);
        fs.writeFileSync(filePath, pdfBuffer);
        break;
      }
      case 'zip': {
        const zipBytes = await debateToPackage(debate, {
          ...exportOptions,
          generatePdf: async (s) => {
            const buf = await debateToPdf(s, exportOptions);
            return new Uint8Array(buf);
          },
        });
        fs.writeFileSync(filePath, Buffer.from(zipBytes));
        break;
      }
      default: {
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
        break;
      }
    }

    return { cancelled: false, filePath };
  });

  // ── Harvest IPC handlers ──────────────────────────────────

  ipcMain.handle('harvest-create-conflict', async (_event, conflict: Record<string, unknown>) => {
    const conflictId = assertSafeId(conflict.claim_id as string, 'conflict id');
    const conflictsDir = path.join(getDataRootPath(), 'conflicts');
    if (!fs.existsSync(conflictsDir)) fs.mkdirSync(conflictsDir, { recursive: true });
    const filePath = path.join(conflictsDir, `${conflictId}.json`);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(conflict, null, 2) + '\n', 'utf-8');
    renameSyncWithRetry(tmpPath, filePath, 7, undefined, recordLockHolder);
    console.log(`[harvest] Created conflict: ${conflictId}`);
    return { created: true, path: filePath };
  });

  ipcMain.handle('harvest-add-debate-ref', async (_event, nodeId: string, debateId: string) => {
    NodeId.parse(nodeId);
    z.string().min(1).parse(debateId);
    const config = loadDataConfig();
    const taxonomyDir = path.join(getDataRootPath(), config.taxonomy_dir);
    // Find which file contains this node
    for (const fname of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']) {
      const filePath = path.join(taxonomyDir, fname);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const node = data.nodes?.find((n: { id: string }) => n.id === nodeId);
      if (!node) continue;
      if (!node.debate_refs) node.debate_refs = [];
      if (!node.debate_refs.includes(debateId)) {
        node.debate_refs.push(debateId);
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
        renameSyncWithRetry(tmpPath, filePath, 7, undefined, recordLockHolder);
        console.log(`[harvest] Added debate_ref ${debateId} to ${nodeId}`);
      }
      return { updated: true };
    }
    return { updated: false, error: `Node ${nodeId} not found` };
  });

  ipcMain.handle('harvest-update-steelman', async (_event, nodeId: string, attackerPov: string, newText: string) => {
    NodeId.parse(nodeId);
    VALID_POV.parse(attackerPov);
    z.string().min(1).parse(newText);
    const config = loadDataConfig();
    const taxonomyDir = path.join(getDataRootPath(), config.taxonomy_dir);
    for (const fname of ['accelerationist.json', 'safetyist.json', 'skeptic.json', 'situations.json']) {
      const filePath = path.join(taxonomyDir, fname);
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const node = data.nodes?.find((n: { id: string }) => n.id === nodeId);
      if (!node) continue;
      if (!node.graph_attributes) node.graph_attributes = {};
      const sv = node.graph_attributes.steelman_vulnerability;
      if (typeof sv === 'string') {
        // Migrate from string to object
        node.graph_attributes.steelman_vulnerability = { [`from_${attackerPov}`]: newText };
      } else if (typeof sv === 'object' && sv !== null) {
        sv[`from_${attackerPov}`] = newText;
      } else {
        node.graph_attributes.steelman_vulnerability = { [`from_${attackerPov}`]: newText };
      }
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
      renameSyncWithRetry(tmpPath, filePath, 7, undefined, recordLockHolder);
      console.log(`[harvest] Updated steelman on ${nodeId} from_${attackerPov}`);
      return { updated: true };
    }
    return { updated: false, error: `Node ${nodeId} not found` };
  });

  ipcMain.handle('harvest-add-verdict', async (_event, conflictId: string, verdict: Record<string, unknown>) => {
    assertSafeId(conflictId, 'conflict id');
    const conflictsDir = path.join(getDataRootPath(), 'conflicts');
    const filePath = path.join(conflictsDir, `${conflictId}.json`);
    if (!fs.existsSync(filePath)) return { updated: false, error: `Conflict ${conflictId} not found` };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data.verdict = verdict;
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    renameSyncWithRetry(tmpPath, filePath, 7, undefined, recordLockHolder);
    console.log(`[harvest] Added verdict to conflict: ${conflictId}`);
    return { updated: true };
  });

  ipcMain.handle('harvest-queue-concept', async (_event, concept: Record<string, unknown>) => {
    const queuePath = path.join(getDataRootPath(), 'harvest-queue.json');
    let queue: { queued_at: string; items: Record<string, unknown>[] } = { queued_at: new Date().toISOString(), items: [] };
    if (fs.existsSync(queuePath)) {
      try { queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8')); } catch { /* telemetry — silent by design;  start fresh */ }
    }
    queue.items.push({ ...concept, status: 'queued', queued_at: new Date().toISOString() });
    queue.queued_at = new Date().toISOString();
    const tmpPath = queuePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    renameSyncWithRetry(tmpPath, queuePath, 7, undefined, recordLockHolder);
    console.log(`[harvest] Queued concept: ${concept.label}`);
    return { queued: true };
  });

  ipcMain.handle('harvest-save-manifest', async (_event, manifest: Record<string, unknown>) => {
    const harvestsDir = path.join(getDataRootPath(), 'harvests');
    if (!fs.existsSync(harvestsDir)) fs.mkdirSync(harvestsDir, { recursive: true });
    const debateId = assertSafeId(manifest.debate_id as string, 'debate id');
    const filePath = path.join(harvestsDir, `${debateId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    console.log(`[harvest] Saved manifest: ${debateId}`);
    return { saved: true };
  });
}
