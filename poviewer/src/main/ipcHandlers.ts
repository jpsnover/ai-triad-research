// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { z } from 'zod';
import fs from 'fs';
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
  SourceMetadataOnDisk,
} from './fileIO.js';
import { storeApiKey, getApiKey, validateApiKey } from './apiKeyStore.js';
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

export function registerIpcHandlers(): void {
  // === No-arg handlers (no validation needed) ===

  ipcMain.handle('get-taxonomy-dirs', () => getTaxonomyDirs());
  ipcMain.handle('get-active-taxonomy-dir', () => getActiveTaxonomyDirName());
  ipcMain.handle('load-settings', () => loadSettings());
  ipcMain.handle('discover-sources', () => discoverSources());
  ipcMain.handle('get-api-key', () => getApiKey());
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
    return result.filePaths;
  });

  // === Single string arg ===

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
    const { extractPdfText } = await import('./pdfExtractor.js');
    return extractPdfText(filePath);
  });

  validatedHandle('open-external-url', z.tuple([z.string().regex(/^https?:\/\//i)]), (_event, url) => {
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

  validatedHandle('add-source', oneUnknown, (_event, meta) => {
    createSourceOnDisk(meta as SourceMetadataOnDisk);
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
      console.error(`[TaxonomyWatcher] Failed to re-read ${pov}:`, err);
    }
  });
}

export function cleanupIpcHandlers(): void {
  stopWatchingTaxonomyFiles();
}
