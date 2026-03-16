// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEBATES_DIR = path.join(PROJECT_ROOT, 'debates');

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
  const files = fs.readdirSync(DEBATES_DIR).filter(f => f.startsWith('debate-') && f.endsWith('.json'));
  const summaries: DebateSessionSummary[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DEBATES_DIR, f), 'utf-8');
      const data = JSON.parse(raw);
      summaries.push({
        id: data.id,
        title: data.title,
        created_at: data.created_at,
        updated_at: data.updated_at,
        phase: data.phase,
      });
    } catch {
      // Skip corrupt files
    }
  }
  summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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
  const filePath = debateFilePath(data.id);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
}

export function deleteDebateSession(id: string): void {
  const filePath = debateFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Debate session not found: ${id}`);
  }
  fs.unlinkSync(filePath);
}
