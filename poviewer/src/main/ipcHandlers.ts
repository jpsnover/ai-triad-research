import { ipcMain, dialog, shell } from 'electron';
import fs from 'fs';
import {
  readTaxonomyFile,
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
  SourceMetadataOnDisk,
} from './fileIO';
import { storeApiKey, getApiKey, validateApiKey } from './apiKeyStore';
import { runAnalysis, cancelAnalysis, getAnalysisStatus } from './aiEngine';
import type { AiSettings, PromptOverrides } from './analysisTypes';

export function registerIpcHandlers(): void {
  // === Existing Handlers ===

  ipcMain.handle('load-taxonomy-file', (_event, pov: string) => {
    return readTaxonomyFile(pov);
  });

  ipcMain.handle('load-snapshot', (_event, sourceId: string) => {
    return readSnapshot(sourceId);
  });

  ipcMain.handle('load-settings', () => {
    return loadSettings();
  });

  ipcMain.handle('save-settings', (_event, data: unknown) => {
    saveSettings(data);
  });

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
      filters: [
        { name: 'Documents', extensions: ['docx', 'pdf', 'md'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths;
  });

  ipcMain.handle('add-source', (_event, meta: SourceMetadataOnDisk) => {
    createSourceOnDisk(meta);
  });

  ipcMain.handle('read-source-file', async (_event, filePath: string) => {
    return readSourceFileContent(filePath);
  });

  // === Pipeline Discovery Handlers ===

  ipcMain.handle('discover-sources', () => {
    return discoverSources();
  });

  ipcMain.handle('load-pipeline-summary', (_event, docId: string) => {
    return loadPipelineSummary(docId);
  });

  // === AI Engine Handlers ===

  ipcMain.handle('store-api-key', async (_event, key: string) => {
    storeApiKey(key);
  });

  ipcMain.handle('get-api-key', () => {
    return getApiKey();
  });

  ipcMain.handle('validate-api-key', async (_event, key: string) => {
    return validateApiKey(key);
  });

  ipcMain.handle('run-analysis', async (_event, sourceId: string, sourceText: string) => {
    const taxonomyJson = readAllTaxonomies();
    const result = await runAnalysis(sourceId, sourceText, taxonomyJson);
    saveAnalysisResult(sourceId, result);
    return result;
  });

  ipcMain.handle('cancel-analysis', (_event, sourceId: string) => {
    cancelAnalysis(sourceId);
  });

  ipcMain.handle('get-analysis-status', (_event, sourceId: string) => {
    return getAnalysisStatus(sourceId);
  });

  // === PDF Handler ===

  ipcMain.handle('get-pdf-bytes', (_event, sourceId: string) => {
    const buf = readRawPdfBytes(sourceId);
    if (!buf) return null;
    // Return as ArrayBuffer for the renderer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('extract-pdf-text', async (_event, filePath: string) => {
    const { extractPdfText } = await import('./pdfExtractor');
    return extractPdfText(filePath);
  });

  ipcMain.handle('open-external-url', (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('analyze-excerpt', async (_event, excerptText: string) => {
    const { analyzeExcerpt } = await import('./aiEngine');
    const taxonomyJson = readAllTaxonomies();
    return analyzeExcerpt(excerptText, taxonomyJson);
  });

  // === Annotation Handlers ===

  ipcMain.handle('save-annotations', (_event, sourceId: string, annotations: unknown) => {
    saveAnnotations(sourceId, annotations);
  });

  ipcMain.handle('load-annotations', (_event, sourceId: string) => {
    return loadAnnotations(sourceId);
  });

  // === Aggregation Handlers ===

  ipcMain.handle('get-aggregation', (_event, sourceIds: string[]) => {
    // Aggregation is computed renderer-side from loaded analysis results
    // This handler loads all analysis results for the given sources
    const results: Record<string, unknown> = {};
    for (const id of sourceIds) {
      const result = loadAnalysisResult(id);
      if (result) results[id] = result;
    }
    return results;
  });

  ipcMain.handle('get-gaps', (_event, _sourceIds: string[]) => {
    // Gaps computed renderer-side; this returns all taxonomy data
    return readAllTaxonomies();
  });

  // === Export Handlers ===

  ipcMain.handle('export-bundle', async (_event, sourceIds: string[], format: string) => {
    const { exportBundle } = await import('./exportService');
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

  ipcMain.handle('export-markdown', async (_event, sourceIds: string[]) => {
    const { generateMarkdownReport } = await import('./exportService');
    return generateMarkdownReport(sourceIds);
  });

  // === Long Doc Handlers ===

  ipcMain.handle('chunk-document', async (_event, text: string) => {
    const { chunkDocument } = await import('./chunkingService');
    return chunkDocument(text);
  });

  ipcMain.handle('get-chunk-status', (_event, sourceId: string) => {
    return getAnalysisStatus(sourceId);
  });

  // === Settings Handlers ===

  ipcMain.handle('get-ai-settings', () => {
    return loadAiSettings();
  });

  ipcMain.handle('save-ai-settings', (_event, settings: AiSettings) => {
    saveAiSettings(settings);
  });

  ipcMain.handle('get-prompt-overrides', () => {
    return loadPromptOverrides();
  });

  ipcMain.handle('save-prompt-overrides', (_event, overrides: PromptOverrides) => {
    savePromptOverrides(overrides);
  });

  // === Analysis Result I/O ===

  ipcMain.handle('load-analysis-result', (_event, sourceId: string) => {
    return loadAnalysisResult(sourceId);
  });
}
