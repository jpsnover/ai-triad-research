// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

export interface DebateSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: string;
  topic_text?: string;
  model?: string;
  turn_count?: number;
}

interface IndexEntry extends DebateSessionSummary {
  file_mtime: number;
}

interface DebateIndex {
  version: 1;
  entries: Record<string, IndexEntry>;
}

const INDEX_FILE = 'debates-index.json';

export function extractSummary(data: Record<string, unknown>): DebateSessionSummary {
  const transcript = Array.isArray(data.transcript) ? data.transcript : [];
  const topic = data.topic as { final?: string; original?: string } | undefined;
  return {
    id: data.id as string,
    title: typeof data.title === 'string' && data.title
      ? data.title
      : typeof data.topic === 'string'
        ? data.topic
        : topic?.final ?? topic?.original ?? 'Untitled',
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
    phase: data.phase as string,
    topic_text: topic?.final ?? topic?.original ?? '',
    model: data.debate_model as string | undefined,
    turn_count: transcript.filter((t: { type?: string }) => t.type === 'statement' || t.type === 'opening').length,
  };
}

function readIndex(debatesDir: string): DebateIndex | null {
  const indexPath = path.join(debatesDir, INDEX_FILE);
  try {
    if (!fs.existsSync(indexPath)) return null;
    const raw = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as DebateIndex;
    if (raw.version !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeIndex(debatesDir: string, index: DebateIndex): void {
  const indexPath = path.join(debatesDir, INDEX_FILE);
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index) + '\n', 'utf-8');
  } catch {
    // Non-fatal — listing still works, just won't be cached
  }
}

/**
 * List debate sessions using a mtime-based summary index.
 * On first call or after new/changed files, reads only the changed files
 * and updates the index. Subsequent calls with no file changes read only
 * the small index file.
 */
export function listDebateSessionsIndexed(debatesDir: string): DebateSessionSummary[] {
  if (!fs.existsSync(debatesDir)) return [];

  const scanDirs = [debatesDir];
  const cliRunsDir = path.join(debatesDir, 'cli-runs');
  if (fs.existsSync(cliRunsDir)) scanDirs.push(cliRunsDir);

  // Collect all debate files with their mtimes (cheap — no file reading)
  const fileEntries: { filePath: string; fileName: string; mtime: number }[] = [];
  for (const dir of scanDirs) {
    const files = fs.readdirSync(dir).filter((f: string) =>
      f.endsWith('.json') && f !== INDEX_FILE && (f.startsWith('debate-') || f.endsWith('-debate.json'))
    );
    for (const f of files) {
      const filePath = path.join(dir, f);
      try {
        const stat = fs.statSync(filePath);
        fileEntries.push({ filePath, fileName: f, mtime: stat.mtimeMs });
      } catch { /* skip inaccessible files */ }
    }
  }

  const existingIndex = readIndex(debatesDir);
  const indexEntries = existingIndex?.entries ?? {};
  const newEntries: Record<string, IndexEntry> = {};
  let indexDirty = false;

  for (const { filePath, mtime } of fileEntries) {
    // Check if we have a cached entry with matching mtime
    const cached = Object.values(indexEntries).find(e => {
      const expectedPath = path.join(debatesDir, `debate-${e.id}.json`);
      return expectedPath === filePath && e.file_mtime === mtime;
    });

    if (cached) {
      newEntries[cached.id] = cached;
      continue;
    }

    // Read and parse only this file
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

      // Migrate cli-runs files to canonical location
      const canonical = `debate-${data.id}.json`;
      const canonicalPath = path.join(debatesDir, canonical);
      if (filePath !== canonicalPath) {
        fs.renameSync(filePath, canonicalPath);
      }

      const summary = extractSummary(data);
      const finalMtime = filePath !== canonicalPath
        ? fs.statSync(canonicalPath).mtimeMs
        : mtime;
      newEntries[summary.id] = { ...summary, file_mtime: finalMtime };
      indexDirty = true;
    } catch {
      // Skip corrupt files
    }
  }

  // Detect removed files
  if (Object.keys(indexEntries).length !== Object.keys(newEntries).length) {
    indexDirty = true;
  }

  if (indexDirty || !existingIndex) {
    writeIndex(debatesDir, { version: 1, entries: newEntries });
  }

  const summaries: DebateSessionSummary[] = Object.values(newEntries).map(
    ({ file_mtime: _, ...summary }) => summary,
  );
  summaries.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  return summaries;
}

/**
 * Update the index for a single session after save.
 * Avoids a full rescan when we already have the session data.
 */
export function updateDebateIndexEntry(debatesDir: string, session: Record<string, unknown>): void {
  const id = session.id as string;
  if (!id) return;

  const filePath = path.join(debatesDir, `debate-${id}.json`);
  let mtime: number;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    return;
  }

  const index = readIndex(debatesDir) ?? { version: 1 as const, entries: {} };
  const summary = extractSummary(session);
  index.entries[id] = { ...summary, file_mtime: mtime };
  writeIndex(debatesDir, index);
}
