// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { getGlobalRecorder } from '../../../lib/flight-recorder/index.js';
import { ActionableError } from '../../../lib/debate/errors.js';
import {
  readTaxonomyFile,
  getTaxonomyDirs,
  getActiveTaxonomyDirName,
  setActiveTaxonomyDir,
  readSnapshot,
  loadSettings,
  saveSettings,
  createSourceOnDisk,
  readSourceFileContent,
  discoverSources,
  loadPipelineSummary,
  saveAnnotations,
  loadAnnotations,
  saveAnalysisResult,
  loadAnalysisResult,
  loadAiSettings,
  saveAiSettings,
  loadPromptOverrides,
  savePromptOverrides,
  readAllTaxonomies,
  readRawPdfBytes,
  watchTaxonomyFiles,
  stopWatchingTaxonomyFiles,
  getSourcesRoot,
  getProjectRoot,
} from './fileIO.js';
import { storeApiKey, hasApiKey, validateApiKey } from './apiKeyStore.js';
import { SAFE_ID_RE, assertContainedIn } from '../../../lib/electron-shared/safeId.js';
import { runAnalysis, cancelAnalysis, getAnalysisStatus } from './aiEngine.js';
import type { AiSettings, PromptOverrides } from './analysisTypes.js';
import {
  validatedHandle,
  oneString,
  twoStrings,
  stringArray,
  stringArrayAndString,
  oneUnknown,
  stringAndUnknown,
} from '../../../lib/electron-shared/utils/validatedIpc.js';

// t/2534 (M7): shape check for renderer-supplied source metadata. The `id`
// becomes an on-disk directory name, so it is refined by the shared SAFE_ID_RE
// (createSourceOnDisk additionally assertSafeId's it at the write site).
const sourceMetadataSchema = z.object({
  id: z.string().regex(SAFE_ID_RE, 'must contain only alphanumerics, hyphens, and underscores'),
  title: z.string(),
  sourceType: z.string(),
  url: z.string().nullable(),
  addedAt: z.string(),
  status: z.string(),
});
const oneSourceMetadata = z.tuple([sourceMetadataSchema]);

// t/2540: dialog-returned-path allowlist. The `read-source-file` handler serves ONLY paths
// the native open dialog handed to the renderer this session (populated by
// 'open-source-file-dialog'). Users may legitimately pick source files anywhere on disk, so a
// fixed-root containment (as in extract-pdf-text) would be wrong here — the native dialog IS the
// authorization. Restores the handler dropped in ef8bac78 which broke AddSourceDialog's add-file flow.
const dialogAuthorizedSourcePaths = new Set<string>();

export function registerIpcHandlers(): void {
  // === No-arg handlers (no validation needed) ===

  ipcMain.handle('get-taxonomy-dirs', () => getTaxonomyDirs());
  ipcMain.handle('get-active-taxonomy-dir', () => getActiveTaxonomyDirName());
  ipcMain.handle('load-settings', () => loadSettings());
  ipcMain.handle('discover-sources', () => discoverSources());
  // t/2534 (M4): presence check only — the raw API key never crosses IPC.
  ipcMain.handle('has-api-key', () => hasApiKey());
  ipcMain.handle('get-ai-settings', () => loadAiSettings());
  ipcMain.handle('get-prompt-overrides', () => loadPromptOverrides());

  ipcMain.handle('open-taxonomy-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Load Taxonomy File',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return { filePath, data };
  });

  ipcMain.handle('open-source-file-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add Source Files',
      filters: [{ name: 'Documents', extensions: ['docx', 'pdf', 'md'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    // t/2540: authorize exactly these dialog-vetted paths for a later read-source-file read.
    for (const fp of result.filePaths) dialogAuthorizedSourcePaths.add(path.resolve(fp));
    return result.filePaths;
  });

  // === Single string arg ===

  // t/2540: restore the read-source-file handler dropped in ef8bac78 — AddSourceDialog's
  // add-file flow calls it after open-source-file-dialog. Containment is the dialog-returned-path
  // allowlist (dialogAuthorizedSourcePaths), NOT a fixed root: the native dialog is the authorization.
  validatedHandle('read-source-file', oneString, (_event, filePath) => {
    const resolved = path.resolve(filePath);
    if (!dialogAuthorizedSourcePaths.has(resolved)) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'poviewer-ipc',
        level: 'warn',
        message: 'read-source-file refused a path not authorized by the native open dialog',
        error: { name: 'SecurityError', message: resolved },
      });
      throw Object.assign(new ActionableError({
        goal: 'Read a source file selected via the Add Source dialog',
        problem: `Refused to read a path the native file dialog did not return this session: ${resolved}`,
        location: 'ipcHandlers.ts:read-source-file',
        nextSteps: [
          'Select the file through Add Source → Browse — the native dialog authorizes the path',
          'Paths are only readable when handed out by dialog.showOpenDialog in this session',
        ],
      }), { statusCode: 400 });
    }
    return readSourceFileContent(resolved);
  });

  validatedHandle('set-taxonomy-dir', oneString, (_event, dirName) => {
    setActiveTaxonomyDir(dirName);
  });

  validatedHandle('load-taxonomy-file', oneString, (_event, pov) => {
    return readTaxonomyFile(pov);
  });

  validatedHandle('load-snapshot', oneString, (_event, sourceId) => {
    return readSnapshot(sourceId);
  });

  validatedHandle('load-pipeline-summary', oneString, (_event, docId) => {
    return loadPipelineSummary(docId);
  });

  validatedHandle('store-api-key', oneString, async (_event, key) => {
    storeApiKey(key);
  });

  validatedHandle('validate-api-key', oneString, async (_event, key) => {
    return validateApiKey(key);
  });

  validatedHandle('cancel-analysis', oneString, (_event, sourceId) => {
    cancelAnalysis(sourceId);
  });

  validatedHandle('get-analysis-status', oneString, (_event, sourceId) => {
    return getAnalysisStatus(sourceId);
  });

  validatedHandle('get-pdf-bytes', oneString, (_event, sourceId) => {
    const buf = readRawPdfBytes(sourceId);
    if (!buf) return null;
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  validatedHandle('extract-pdf-text', oneString, async (_event, filePath) => {
    // t/2534 (M10): the renderer must not be able to read arbitrary absolute
    // paths — constrain to the taxonomy data root or the app's sources dir.
    const resolved = path.resolve(filePath);
    const allowedRoots = [path.resolve(getSourcesRoot()), path.resolve(getProjectRoot())];
    const contained = allowedRoots.some((root) => {
      try {
        assertContainedIn(resolved, root);
        return true;
      } catch {
        /* telemetry — silent by design */
        return false;
      }
    });
    if (!contained) {
      throw Object.assign(new ActionableError({
        goal: 'Extract text from a PDF file',
        problem: `Blocked PDF path outside the data root and sources directory: ${resolved}`,
        location: 'ipcHandlers.ts:extract-pdf-text',
        nextSteps: [
          'Only PDFs under the project data root or the sources directory can be extracted',
          'Ingest the document as a source first, then extract from its raw/ directory (see get-pdf-bytes)',
        ],
      }), { statusCode: 400 });
    }
    const { extractPdfText } = await import('./pdfExtractor.js');
    return extractPdfText(resolved);
  });

  validatedHandle('open-external-url', oneString, (_event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new ActionableError({
        goal: 'Open external URL in default browser',
        problem: `Blocked non-HTTP URL: ${url}`,
        location: 'ipcHandlers.ts:open-external-url',
        nextSteps: ['Only https:// and http:// URLs are allowed'],
      });
    }
    shell.openExternal(url);
  });

  validatedHandle('analyze-excerpt', oneString, async (_event, excerptText) => {
    const { analyzeExcerpt } = await import('./aiEngine.js');
    const taxonomyJson = readAllTaxonomies();
    return analyzeExcerpt(excerptText, taxonomyJson);
  });

  validatedHandle('load-annotations', oneString, (_event, sourceId) => {
    return loadAnnotations(sourceId);
  });

  validatedHandle('get-chunk-status', oneString, (_event, sourceId) => {
    return getAnalysisStatus(sourceId);
  });

  validatedHandle('load-analysis-result', oneString, (_event, sourceId) => {
    return loadAnalysisResult(sourceId);
  });

  validatedHandle('chunk-document', oneString, async (_event, text) => {
    const { chunkDocument } = await import('./chunkingService.js');
    return chunkDocument(text);
  });

  // === Two string args ===

  validatedHandle('run-analysis', twoStrings, async (_event, sourceId, sourceText) => {
    const taxonomyJson = readAllTaxonomies();
    const result = await runAnalysis(sourceId, sourceText, taxonomyJson);
    saveAnalysisResult(sourceId, result);
    return result;
  });

  // === String + unknown ===

  validatedHandle('save-annotations', stringAndUnknown, (_event, sourceId, annotations) => {
    saveAnnotations(sourceId, annotations);
  });

  // === String array ===

  validatedHandle('get-aggregation', stringArray, (_event, sourceIds) => {
    const results: Record<string, unknown> = {};
    for (const id of sourceIds) {
      const result = loadAnalysisResult(id);
      if (result) results[id] = result;
    }
    return results;
  });

  validatedHandle('get-gaps', stringArray, (_event, _sourceIds) => {
    return readAllTaxonomies();
  });

  validatedHandle('export-markdown', stringArray, async (_event, sourceIds) => {
    const { generateMarkdownReport } = await import('./exportService.js');
    return generateMarkdownReport(sourceIds);
  });

  // === String array + string ===

  validatedHandle('export-bundle', stringArrayAndString, async (_event, sourceIds, format) => {
    const { exportBundle } = await import('./exportService.js');
    const savePath = await dialog.showSaveDialog({
      title: 'Export Analysis',
      defaultPath: `poviewer-export-${Date.now()}`,
      filters: format === 'markdown'
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (savePath.canceled || !savePath.filePath) return null;
    await exportBundle(sourceIds, savePath.filePath, format);
    return savePath.filePath;
  });

  // === Object/unknown args ===

  validatedHandle('save-settings', oneUnknown, (_event, data) => {
    saveSettings(data);
  });

  validatedHandle('add-source', oneSourceMetadata, (_event, meta) => {
    createSourceOnDisk(meta);
  });

  validatedHandle('save-ai-settings', oneUnknown, (_event, settings) => {
    saveAiSettings(settings as AiSettings);
  });

  validatedHandle('save-prompt-overrides', oneUnknown, (_event, overrides) => {
    savePromptOverrides(overrides as PromptOverrides);
  });

  // === Taxonomy File Watching ===
  watchTaxonomyFiles((pov) => {
    try {
      const data = readTaxonomyFile(pov);
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('taxonomy-changed', { pov, data });
      }
      console.log(`[TaxonomyWatcher] Broadcast taxonomy-changed for ${pov}`);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'taxonomy-watcher',
        level: 'error',
        message: `Failed to re-read taxonomy for ${pov}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      console.error(`[TaxonomyWatcher] Failed to re-read ${pov}:`, err);
    }
  });
}

export function cleanupIpcHandlers(): void {
  stopWatchingTaxonomyFiles();
}
