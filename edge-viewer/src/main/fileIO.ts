// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const TAXONOMY_BASE = path.join(PROJECT_ROOT, 'taxonomy');

let activeTaxonomyDir = path.join(TAXONOMY_BASE, 'Origin');

const POV_FILE_MAP: Record<string, string> = {
  accelerationist: 'accelerationist.json',
  safetyist: 'safetyist.json',
  skeptic: 'skeptic.json',
  'cross-cutting': 'cross-cutting.json',
};

export function getTaxonomyDirs(): string[] {
  if (!fs.existsSync(TAXONOMY_BASE)) return [];
  return fs
    .readdirSync(TAXONOMY_BASE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'schemas')
    .map((d) => d.name);
}

export function getActiveTaxonomyDir(): string {
  return path.basename(activeTaxonomyDir);
}

export function setTaxonomyDir(dirName: string): void {
  const newDir = path.join(TAXONOMY_BASE, dirName);
  if (!fs.existsSync(newDir)) throw new Error(`Taxonomy dir not found: ${newDir}`);
  activeTaxonomyDir = newDir;
}

export function readAllNodes(): { pov: string; nodes: unknown[] }[] {
  const result: { pov: string; nodes: unknown[] }[] = [];
  for (const [pov, filename] of Object.entries(POV_FILE_MAP)) {
    const filePath = path.join(activeTaxonomyDir, filename);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    result.push({ pov, nodes: data.nodes || [] });
  }
  return result;
}

export function readEdges(): unknown {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  if (!fs.existsSync(edgesPath)) return null;
  const raw = fs.readFileSync(edgesPath, 'utf-8');
  return JSON.parse(raw);
}

export function writeEdges(edgesData: Record<string, unknown>): void {
  const edgesPath = path.join(activeTaxonomyDir, 'edges.json');
  edgesData['last_modified'] = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify(edgesData, null, 2);
  fs.writeFileSync(edgesPath, json, 'utf-8');
}
