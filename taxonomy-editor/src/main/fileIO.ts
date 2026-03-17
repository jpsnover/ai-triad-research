// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const TAXONOMY_BASE = path.join(PROJECT_ROOT, 'taxonomy');
let activeTaxonomyDir = path.join(TAXONOMY_BASE, 'Origin');
const CONFLICTS_DIR = path.join(PROJECT_ROOT, 'conflicts');

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
