// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SoulDocumentSchema, type SoulDocument } from './soulDocSchema.js';
import { ActionableError } from '../errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_DOCS_DIR = resolve(__dirname, 'soul-docs');

const CHARACTERS = ['accelerationist', 'safetyist', 'skeptic'] as const;

export type CharacterId = typeof CHARACTERS[number];

let _cache: Map<CharacterId, SoulDocument> | null = null;

export function loadSoulDocuments(): Map<CharacterId, SoulDocument> {
  if (_cache) return _cache;

  const docs = new Map<CharacterId, SoulDocument>();

  for (const pov of CHARACTERS) {
    const filePath = resolve(SOUL_DOCS_DIR, `${pov}.soul.json`);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new ActionableError({
        goal: `Load soul document for ${pov}`,
        problem: `File not found or unreadable: ${filePath}`,
        location: 'soulDocLoader.ts:loadSoulDocuments',
        nextSteps: [`Verify ${pov}.soul.json exists in lib/debate/soul-docs/`, 'Run the soul doc schema tests to check file integrity'],
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ActionableError({
        goal: `Parse soul document for ${pov}`,
        problem: `Invalid JSON in ${filePath}`,
        location: 'soulDocLoader.ts:loadSoulDocuments',
        nextSteps: ['Check the file for syntax errors', 'Run the soul doc schema tests'],
      });
    }

    const result = SoulDocumentSchema.safeParse(parsed);
    if (!result.success) {
      throw new ActionableError({
        goal: `Validate soul document for ${pov}`,
        problem: `Schema validation failed: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        location: 'soulDocLoader.ts:loadSoulDocuments',
        nextSteps: ['Fix the validation errors in the soul document JSON', 'Run the soul doc schema tests'],
      });
    }

    if (result.data.pov !== pov) {
      throw new ActionableError({
        goal: `Validate soul document for ${pov}`,
        problem: `pov field "${result.data.pov}" does not match filename "${pov}.soul.json"`,
        location: 'soulDocLoader.ts:loadSoulDocuments',
        nextSteps: [`Set "pov": "${pov}" in ${pov}.soul.json`],
      });
    }

    docs.set(pov, result.data);
  }

  _cache = docs;
  return docs;
}

export function getSoulDocument(pov: CharacterId): SoulDocument {
  const docs = loadSoulDocuments();
  return docs.get(pov)!;
}

export function clearSoulDocCache(): void {
  _cache = null;
}
