// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// ── Data path resolution from .aitriad.json ──
interface AiTriadConfig {
  data_root: string;
  taxonomy_dir: string;
  sources_dir: string;
  summaries_dir: string;
  conflicts_dir: string;
  debates_dir: string;
  queue_file: string;
  version_file: string;
}

function loadDataConfig(): AiTriadConfig {
  const defaults: AiTriadConfig = {
    data_root: '.',
    taxonomy_dir: 'taxonomy/Origin',
    sources_dir: 'sources',
    summaries_dir: 'summaries',
    conflicts_dir: 'conflicts',
    debates_dir: 'debates',
    queue_file: '.summarise-queue.json',
    version_file: 'TAXONOMY_VERSION',
  };
  try {
    const configPath = path.join(PROJECT_ROOT, '.aitriad.json');
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...defaults, ...raw };
    }
  } catch { /* use defaults */ }
  return defaults;
}

function resolveDataPath(subPath: string): string {
  const config = loadDataConfig();
  const envRoot = process.env.AI_TRIAD_DATA_ROOT;
  const dataRoot = envRoot || (path.isAbsolute(config.data_root)
    ? config.data_root
    : path.resolve(PROJECT_ROOT, config.data_root));
  return path.isAbsolute(subPath) ? subPath : path.resolve(dataRoot, subPath);
}

const _config = loadDataConfig();
const TAXONOMY_BASE = path.dirname(resolveDataPath(_config.taxonomy_dir));
let activeTaxonomyDir = resolveDataPath(_config.taxonomy_dir);
const CONFLICTS_DIR = resolveDataPath(_config.conflicts_dir);

export { PROJECT_ROOT, resolveDataPath };

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  'cross-cutting': 'cross-cutting.json',
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

export function writeTaxonomyFile(pov: string, data: unknown): void {
  const filename = POV_FILE_MAP[pov];
  if (!filename) {
    throw new Error(`Unknown POV: ${pov}`);
  }
  const filePath = path.join(activeTaxonomyDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function readAllConflictFiles(): unknown[] {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    return [];
  }
  const files = fs.readdirSync(CONFLICTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const raw = fs.readFileSync(path.join(CONFLICTS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
}

export function writeConflictFile(claimId: string, data: unknown): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function createConflictFile(claimId: string, data: unknown): void {
  if (!fs.existsSync(CONFLICTS_DIR)) {
    fs.mkdirSync(CONFLICTS_DIR, { recursive: true });
  }
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Conflict file already exists: ${claimId}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function deleteConflictFile(claimId: string): void {
  const filePath = path.join(CONFLICTS_DIR, `${claimId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conflict file not found: ${claimId}`);
  }
  fs.unlinkSync(filePath);
}

export function readEdgesFile(): unknown | null {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  if (!fs.existsSync(edgesPath)) return null;
  const raw = fs.readFileSync(edgesPath, 'utf-8');
  return JSON.parse(raw);
}

export function writeEdgesFile(data: unknown): void {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  fs.writeFileSync(edgesPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
