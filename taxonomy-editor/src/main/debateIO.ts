// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { resolveDataPath } from './fileIO';

const DEBATES_DIR = resolveDataPath('debates');

export interface DebateSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  phase: string;
}

function ensureDebatesDir(): void {
  if (!fs.existsSync(DEBATES_DIR)) {
    fs.mkdirSync(DEBATES_DIR, { recursive: true });
  }
}

function debateFilePath(id: string): string {
  return path.join(DEBATES_DIR, `debate-${id}.json`);
}

export function listDebateSessions(): DebateSessionSummary[] {
  if (!fs.existsSync(DEBATES_DIR)) return [];

  // Scan root debates dir + cli-runs subdirectory
  const scanDirs = [DEBATES_DIR];
  const cliRunsDir = path.join(DEBATES_DIR, 'cli-runs');
  if (fs.existsSync(cliRunsDir)) scanDirs.push(cliRunsDir);

  const summaries: DebateSessionSummary[] = [];
  for (const scanDir of scanDirs) {
    const files = fs.readdirSync(scanDir).filter(f =>
      f.endsWith('.json') && (f.startsWith('debate-') || f.endsWith('-debate.json'))
    );
    for (const f of files) {
      try {
        const currentPath = path.join(scanDir, f);
        const data = JSON.parse(fs.readFileSync(currentPath, 'utf-8'));
        // Move cli-runs files to root debates dir with canonical naming
        const canonical = `debate-${data.id}.json`;
        const canonicalPath = path.join(DEBATES_DIR, canonical);
        if (currentPath !== canonicalPath) {
          fs.renameSync(currentPath, canonicalPath);
        }
        summaries.push({
          id: data.id,
          title: data.title || data.topic || 'Untitled',
          created_at: data.created_at,
          updated_at: data.updated_at,
          phase: data.phase,
        });
      } catch {
        // Skip corrupt files
      }
    }
  }
  summaries.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  return summaries;
}

export function loadDebateSession(id: string): unknown {
  const filePath = debateFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveDebateSession(session: unknown): void {
  ensureDebatesDir();
  const data = session as { id: string };
  if (!data.id || typeof data.id !== 'string') {
    throw new Error('Cannot save debate session: missing or invalid ID');
  }
  const filePath = debateFilePath(data.id);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');

  // Log calibration data for completed debates (non-blocking)
  try {
    const s = session as { transcript?: { type: string }[] };
    if (s?.transcript?.some(e => e.type === 'concluding')) {
      const { extractCalibrationData, appendCalibrationLog } = require('../../../lib/debate/calibrationLogger');
      const dataRoot = path.dirname(DEBATES_DIR); // data root is parent of debates/
      const dataPoint = extractCalibrationData(session, 'local' as const);
      appendCalibrationLog(dataPoint, dataRoot);
    }
  } catch { /* calibration logging never blocks save */ }
}

export function deleteDebateSession(id: string): void {
  const filePath = debateFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  fs.unlinkSync(filePath);
}

// ── Debate comments ────────────────────────────────────────

function commentsFilePath(debateId: string): string {
  return path.join(DEBATES_DIR, `debate-${debateId}-comments.json`);
}

export function loadDebateComments(debateId: string): unknown {
  ensureDebatesDir();
  const filePath = commentsFilePath(debateId);
  if (!fs.existsSync(filePath)) {
    return { _schema_version: '1', debateId, comments: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveDebateComments(debateId: string, data: unknown): void {
  ensureDebatesDir();
  const filePath = commentsFilePath(debateId);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
