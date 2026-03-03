import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // === Taxonomy Directory APIs ===
  getTaxonomyDirs: (): Promise<string[]> =>
    ipcRenderer.invoke('get-taxonomy-dirs'),

  getActiveTaxonomyDir: (): Promise<string> =>
    ipcRenderer.invoke('get-active-taxonomy-dir'),

  setTaxonomyDir: (dirName: string): Promise<void> =>
    ipcRenderer.invoke('set-taxonomy-dir', dirName),

  // === Existing APIs ===
  loadTaxonomyFile: (pov: string): Promise<unknown> =>
    ipcRenderer.invoke('load-taxonomy-file', pov),

  loadSnapshot: (sourceId: string): Promise<string> =>
    ipcRenderer.invoke('load-snapshot', sourceId),

  loadSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('load-settings'),

  saveSettings: (data: unknown): Promise<void> =>
    ipcRenderer.invoke('save-settings', data),

  openTaxonomyDialog: (): Promise<{ filePath: string; data: unknown } | null> =>
    ipcRenderer.invoke('open-taxonomy-dialog'),

  openSourceFileDialog: (): Promise<string[] | null> =>
    ipcRenderer.invoke('open-source-file-dialog'),

  addSource: (meta: { id: string; title: string; sourceType: string; url: string | null; addedAt: string; status: string }): Promise<void> =>
    ipcRenderer.invoke('add-source', meta),

  readSourceFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-source-file', filePath),

  // === Pipeline Discovery APIs ===
  discoverSources: (): Promise<unknown[]> =>
    ipcRenderer.invoke('discover-sources'),

  loadPipelineSummary: (docId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-pipeline-summary', docId),

  // === AI Engine APIs ===
  storeApiKey: (key: string): Promise<void> =>
    ipcRenderer.invoke('store-api-key', key),

  getApiKey: (): Promise<string | null> =>
    ipcRenderer.invoke('get-api-key'),

  validateApiKey: (key: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke('validate-api-key', key),

  runAnalysis: (sourceId: string, sourceText: string): Promise<unknown> =>
    ipcRenderer.invoke('run-analysis', sourceId, sourceText),

  cancelAnalysis: (sourceId: string): Promise<void> =>
    ipcRenderer.invoke('cancel-analysis', sourceId),

  getAnalysisStatus: (sourceId: string): Promise<{ running: boolean }> =>
    ipcRenderer.invoke('get-analysis-status', sourceId),

  // === PDF APIs ===
  getPdfBytes: (sourceId: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('get-pdf-bytes', sourceId),

  extractPdfText: (filePath: string): Promise<{ fullText: string; pageBreaks: number[] }> =>
    ipcRenderer.invoke('extract-pdf-text', filePath),

  openExternalUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external-url', url),

  analyzeExcerpt: (excerptText: string): Promise<unknown> =>
    ipcRenderer.invoke('analyze-excerpt', excerptText),

  // === Annotation APIs ===
  saveAnnotations: (sourceId: string, annotations: unknown): Promise<void> =>
    ipcRenderer.invoke('save-annotations', sourceId, annotations),

  loadAnnotations: (sourceId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-annotations', sourceId),

  // === Aggregation APIs ===
  getAggregation: (sourceIds: string[]): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('get-aggregation', sourceIds),

  getGaps: (sourceIds: string[]): Promise<string> =>
    ipcRenderer.invoke('get-gaps', sourceIds),

  // === Export APIs ===
  exportBundle: (sourceIds: string[], format: string): Promise<string | null> =>
    ipcRenderer.invoke('export-bundle', sourceIds, format),

  exportMarkdown: (sourceIds: string[]): Promise<string> =>
    ipcRenderer.invoke('export-markdown', sourceIds),

  // === Long Doc APIs ===
  chunkDocument: (text: string): Promise<string[]> =>
    ipcRenderer.invoke('chunk-document', text),

  getChunkStatus: (sourceId: string): Promise<{ running: boolean }> =>
    ipcRenderer.invoke('get-chunk-status', sourceId),

  // === Settings APIs ===
  getAiSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('get-ai-settings'),

  saveAiSettings: (settings: unknown): Promise<void> =>
    ipcRenderer.invoke('save-ai-settings', settings),

  getPromptOverrides: (): Promise<unknown> =>
    ipcRenderer.invoke('get-prompt-overrides'),

  savePromptOverrides: (overrides: unknown): Promise<void> =>
    ipcRenderer.invoke('save-prompt-overrides', overrides),

  // === Analysis Result I/O ===
  loadAnalysisResult: (sourceId: string): Promise<unknown> =>
    ipcRenderer.invoke('load-analysis-result', sourceId),

  // === Event Listeners ===
  onAnalysisProgress: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data);
    ipcRenderer.on('analysis-progress', handler);
    return () => ipcRenderer.removeListener('analysis-progress', handler);
  },

  onTaxonomyChanged: (callback: (event: { pov: string; data: unknown }) => void): (() => void) => {
    const handler = (_event: unknown, data: { pov: string; data: unknown }) => callback(data);
    ipcRenderer.on('taxonomy-changed', handler);
    return () => ipcRenderer.removeListener('taxonomy-changed', handler);
  },
});
