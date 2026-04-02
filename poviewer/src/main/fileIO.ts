// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AiSettings, PromptOverrides } from './analysisTypes';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_DIR = path.join(os.homedir(), '.poviewer');

const TAXONOMY_BASE = path.join(PROJECT_ROOT, 'taxonomy');
let activeTaxonomyDir = path.join(TAXONOMY_BASE, 'Origin');
const SOURCES_DIR = path.join(PROJECT_ROOT, 'sources');
const SETTINGS_PATH = path.join(PROJECT_ROOT, 'poviewer', 'settings.json');
const AI_SETTINGS_PATH = path.join(CONFIG_DIR, 'ai-settings.json');
const PROMPTS_PATH = path.join(CONFIG_DIR, 'prompts.json');

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  'situations': 'situations.json',
};

export function getTaxonomyDirs(): string[] {
  if (!fs.existsSync(TAXONOMY_BASE)) return [];
  return fs.readdirSync(TAXONOMY_BASE, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'schemas')
    .map(d => d.name);
}

export function getActiveTaxonomyDirName(): string {
  return path.basename(activeTaxonomyDir);
}

export function setActiveTaxonomyDir(dirName: string): void {
  const newDir = path.join(TAXONOMY_BASE, dirName);
  if (!fs.existsSync(newDir)) {
    throw new Error(`Taxonomy directory not found: ${dirName}`);
  }
  activeTaxonomyDir = newDir;
}

export function readTaxonomyFile(pov: string): unknown {
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  const filePath = path.join(activeTaxonomyDir, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function readSnapshot(sourceId: string): string {
  const filePath = path.join(SOURCES_DIR, sourceId, 'snapshot.md');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${sourceId}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function loadSettings(): unknown {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return {};
  }
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw);
}

export function saveSettings(data: unknown): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export interface SourceMetadataOnDisk {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  addedAt: string;
  status: string;
}

export function createSourceOnDisk(meta: SourceMetadataOnDisk): void {
  const sourceDir = path.join(SOURCES_DIR, meta.id);
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(sourceDir, 'metadata.json'),
    JSON.stringify(meta, null, 2) + '\n',
    'utf-8',
  );
  const snapshotPath = path.join(sourceDir, 'snapshot.md');
  if (!fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, '', 'utf-8');
  }
}

// === Read Source File Content ===

export async function readSourceFileContent(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const { extractPdfText } = await import('./pdfExtractor');
    const result = await extractPdfText(filePath);
    return result.fullText;
  }

  if (ext === '.docx') {
    // For docx, read raw text (basic extraction)
    // Full docx parsing would require a dedicated library
    // For now, return a placeholder directing user to convert to .md
    return `[DOCX file: ${path.basename(filePath)}]\n\nDOCX text extraction requires conversion. Use the Import-Document script to convert to Markdown first, or add the .md version of this file.`;
  }

  throw new Error(`Unsupported file type: ${ext}`);
}

// === Discover Sources from Pipeline ===

export interface DiscoveredSource {
  id: string;
  title: string;
  sourceType: string;
  url: string | null;
  authors: string[];
  dateIngested: string;
  povTags: string[];
  topicTags: string[];
  oneLiner: string;
  summaryStatus: string;
  snapshotText: string;
  hasSummary: boolean;
}

export interface PipelineSummary {
  doc_id: string;
  taxonomy_version: string;
  generated_at: string;
  ai_model: string;
  temperature: number;
  pov_summaries: Record<string, {
    stance?: string;
    key_points: Array<{
      taxonomy_node_id: string | null;
      category: string;
      point: string;
      excerpt_context: string;
      stance?: string;
    }>;
  }>;
  factual_claims: Array<{
    claim: string;
    doc_position: string;
    potential_conflict_id: string | null;
  }>;
  unmapped_concepts: Array<{
    concept: string;
    suggested_pov: string;
    suggested_category: string;
    reason: string;
  }>;
}

const SUMMARIES_DIR = path.join(PROJECT_ROOT, 'summaries');

export function discoverSources(): DiscoveredSource[] {
  const results: DiscoveredSource[] = [];

  if (!fs.existsSync(SOURCES_DIR)) return results;

  const dirs = fs.readdirSync(SOURCES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const metaPath = path.join(SOURCES_DIR, dir.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

      // Read snapshot text
      const snapshotPath = path.join(SOURCES_DIR, dir.name, 'snapshot.md');
      const snapshotText = fs.existsSync(snapshotPath)
        ? fs.readFileSync(snapshotPath, 'utf-8')
        : '';

      // Skip sources with empty snapshots (not fully ingested)
      if (!snapshotText.trim()) continue;

      // Check if summary exists
      const summaryPath = path.join(SUMMARIES_DIR, `${dir.name}.json`);
      const hasSummary = fs.existsSync(summaryPath);

      results.push({
        id: meta.id || dir.name,
        title: meta.title || dir.name,
        sourceType: meta.source_type || 'unknown',
        url: meta.url || null,
        authors: meta.authors || [],
        dateIngested: meta.date_ingested || '',
        povTags: meta.pov_tags || [],
        topicTags: meta.topic_tags || [],
        oneLiner: meta.one_liner || '',
        summaryStatus: meta.summary_status || 'pending',
        snapshotText,
        hasSummary,
      });
    } catch {
      // Skip sources with invalid metadata
    }
  }

  return results;
}

export function loadPipelineSummary(docId: string): PipelineSummary | null {
  const summaryPath = path.join(SUMMARIES_DIR, `${docId}.json`);
  if (!fs.existsSync(summaryPath)) return null;
  const raw = fs.readFileSync(summaryPath, 'utf-8');
  return JSON.parse(raw);
}

// === Annotation File I/O ===

export function saveAnnotations(sourceId: string, annotations: unknown): void {
  const sourceDir = path.join(SOURCES_DIR, sourceId);
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(sourceDir, 'annotations.json'),
    JSON.stringify(annotations, null, 2) + '\n',
    'utf-8',
  );
}

export function loadAnnotations(sourceId: string): unknown {
  const filePath = path.join(SOURCES_DIR, sourceId, 'annotations.json');
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// === Analysis Result I/O ===

export function saveAnalysisResult(sourceId: string, result: unknown): void {
  const sourceDir = path.join(SOURCES_DIR, sourceId);
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(sourceDir, 'analysis.json'),
    JSON.stringify(result, null, 2) + '\n',
    'utf-8',
  );
}

export function loadAnalysisResult(sourceId: string): unknown | null {
  const filePath = path.join(SOURCES_DIR, sourceId, 'analysis.json');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// === AI Settings I/O ===

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadAiSettings(): AiSettings {
  if (fs.existsSync(AI_SETTINGS_PATH)) {
    const raw = fs.readFileSync(AI_SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw);
  }
  return { model: 'gemini-3.1-flash-lite-preview', temperature: 0.1 };
}

export function saveAiSettings(settings: AiSettings): void {
  ensureConfigDir();
  fs.writeFileSync(AI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

// === Prompt Overrides I/O ===

export function loadPromptOverrides(): PromptOverrides | null {
  if (fs.existsSync(PROMPTS_PATH)) {
    const raw = fs.readFileSync(PROMPTS_PATH, 'utf-8');
    return JSON.parse(raw);
  }
  return null;
}

export function savePromptOverrides(overrides: PromptOverrides): void {
  ensureConfigDir();
  fs.writeFileSync(PROMPTS_PATH, JSON.stringify(overrides, null, 2) + '\n', 'utf-8');
}

// === Taxonomy Loading Helpers ===

export function readAllTaxonomies(): string {
  const result: Record<string, unknown> = {};
  for (const [pov, filename] of Object.entries(POV_FILE_MAP)) {
    const filePath = path.join(activeTaxonomyDir, filename);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      result[pov] = JSON.parse(raw);
    }
  }
  return JSON.stringify(result, null, 2);
}

// === Export Helpers ===

export function getSourceDir(sourceId: string): string {
  return path.join(SOURCES_DIR, sourceId);
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

// === Raw PDF Path Resolution ===

export function findRawPdfPath(sourceId: string): string | null {
  const rawDir = path.join(SOURCES_DIR, sourceId, 'raw');
  if (!fs.existsSync(rawDir)) return null;
  const files = fs.readdirSync(rawDir);
  const pdf = files.find(f => f.toLowerCase().endsWith('.pdf'));
  if (!pdf) return null;
  return path.join(rawDir, pdf);
}

export function readRawPdfBytes(sourceId: string): Buffer | null {
  const pdfPath = findRawPdfPath(sourceId);
  if (!pdfPath) return null;
  return fs.readFileSync(pdfPath);
}

// === Taxonomy File Watching ===

const activeWatchers: fs.FSWatcher[] = [];

export function watchTaxonomyFiles(onChange: (pov: string) => void): void {
  stopWatchingTaxonomyFiles();

  const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  for (const [pov, filename] of Object.entries(POV_FILE_MAP)) {
    const filePath = path.join(activeTaxonomyDir, filename);
    if (!fs.existsSync(filePath)) continue;

    try {
      const watcher = fs.watch(filePath, () => {
        // Debounce: editors often fire multiple events per save
        if (debounceTimers[pov]) clearTimeout(debounceTimers[pov]);
        debounceTimers[pov] = setTimeout(() => {
          console.log(`[TaxonomyWatcher] Change detected: ${pov} (${filename})`);
          onChange(pov);
        }, 300);
      });

      activeWatchers.push(watcher);
      console.log(`[TaxonomyWatcher] Watching ${filename}`);
    } catch (err) {
      console.error(`[TaxonomyWatcher] Failed to watch ${filename}:`, err);
    }
  }
}

export function stopWatchingTaxonomyFiles(): void {
  for (const watcher of activeWatchers) {
    watcher.close();
  }
  activeWatchers.length = 0;
  console.log('[TaxonomyWatcher] All watchers stopped');
}
