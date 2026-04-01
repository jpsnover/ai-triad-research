// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs';
import path from 'path';

import { resolveDataPath } from './fileIO';

const CHATS_DIR = resolveDataPath('chats');

export interface ChatSessionSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  mode: string;
  pover: string;
}

function ensureChatsDir(): void {
  if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true });
  }
}

function chatFilePath(id: string): string {
  return path.join(CHATS_DIR, `chat-${id}.json`);
}

export function listChatSessions(): ChatSessionSummary[] {
  if (!fs.existsSync(CHATS_DIR)) return [];
  const files = fs.readdirSync(CHATS_DIR).filter(f => f.startsWith('chat-') && f.endsWith('.json'));
  const summaries: ChatSessionSummary[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(CHATS_DIR, f), 'utf-8');
      const data = JSON.parse(raw);
      summaries.push({
        id: data.id,
        title: data.title,
        created_at: data.created_at,
        updated_at: data.updated_at,
        mode: data.mode,
        pover: data.pover,
      });
    } catch {
      // Skip corrupt files
    }
  }
  summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return summaries;
}

export function loadChatSession(id: string): unknown {
  const filePath = chatFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chat session not found: ${id}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

export function saveChatSession(session: unknown): void {
  ensureChatsDir();
  const data = session as { id: string };
  const filePath = chatFilePath(data.id);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + '\n', 'utf-8');
}

export function deleteChatSession(id: string): void {
  const filePath = chatFilePath(id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chat session not found: ${id}`);
  }
  fs.unlinkSync(filePath);
}
