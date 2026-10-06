// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { readFileSync } from 'fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SoulDocumentSchema, type SoulDocument } from './soulDocSchema.js';
import { ActionableError } from './errors.js';
import { getGlobalRecorder } from '../flight-recorder/index.js';
import type { PovInfo, SpeakerId } from './types.js';
import type { TagSelection } from './types/session.js';
import { POVER_INFO } from './poverInfo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUL_DOCS_DIR = resolve(__dirname, 'soul-docs');
const TAG_SOUL_DOCS_DIR = resolve(SOUL_DOCS_DIR, 'tags');

const CHARACTERS = ['accelerationist', 'safetyist', 'skeptic'] as const;

export type CharacterId = typeof CHARACTERS[number];

/** Provenance for a loaded soul file. */
export interface SoulProvenance {
  /** Absolute path to the soul file. */
  file: string;
  /** First 16 hex digits of the SHA-256 of the file content at load time. */
  sha: string;
}

// ── Internal caches ───────────────────────────────────────────────────────────

/** Base soul cache (keyed by CharacterId). Eager-loaded by loadSoulDocuments(). */
let _baseCache: Map<CharacterId, SoulDocument> | null = null;
/** Tag soul cache (keyed "${pov}:${tag}"). Lazy-loaded on first getSoulDocument(pov, tag) call. */
const _tagCache = new Map<string, SoulDocument>();
/** Provenance for base souls (keyed CharacterId) and tag souls (keyed "${pov}:${tag}"). */
const _provenanceCache = new Map<string, SoulProvenance>();

// ── Base soul loading ─────────────────────────────────────────────────────────

export function loadSoulDocuments(): Map<CharacterId, SoulDocument> {
  if (_baseCache) return _baseCache;

  const docs = new Map<CharacterId, SoulDocument>();

  for (const pov of CHARACTERS) {
    const filePath = resolve(SOUL_DOCS_DIR, `${pov}.soul.json`);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'soul-doc-loader',
        level: 'error',
        message: `Failed to read soul document file: ${filePath}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
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
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'soul-doc-loader',
        level: 'error',
        message: `Failed to parse soul document JSON: ${filePath}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      throw new ActionableError({
        goal: `Parse soul document for ${pov}`,
        problem: `Invalid JSON in ${filePath}`,
        location: 'soulDocLoader.ts:loadSoulDocuments',
        nextSteps: ['Check the file for syntax errors', 'Run the soul doc schema tests'],
      });
    }

    const result = SoulDocumentSchema.safeParse(parsed);
    if (!result.success) {
      const validationSummary = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ActionableError({
        goal: `Validate soul document for ${pov}`,
        problem: `Schema validation failed: ${validationSummary}`,
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
    _provenanceCache.set(pov, {
      file: filePath,
      sha: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    });
  }

  _baseCache = docs;
  return docs;
}

// ── Tag soul loading (lazy) ───────────────────────────────────────────────────

function loadTagSoulDocument(pov: CharacterId, tag: string): SoulDocument {
  const cacheKey = `${pov}:${tag}`;
  const cached = _tagCache.get(cacheKey);
  if (cached) return cached;

  const filePath = resolve(TAG_SOUL_DOCS_DIR, `${tag}.${pov}.soul.json`);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'soul-doc-loader',
      level: 'error',
      message: `Failed to read tag soul document: ${filePath}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    throw new ActionableError({
      goal: `Load tag soul document for ${pov} / tag "${tag}"`,
      problem: `File not found or unreadable: ${filePath}`,
      location: 'soulDocLoader.ts:loadTagSoulDocument',
      nextSteps: [
        `Verify ${tag}.${pov}.soul.json exists in lib/debate/soul-docs/tags/`,
        `Check lib/debate/soul-docs/pov-tags.json — only registered tags are valid`,
      ],
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'soul-doc-loader',
      level: 'error',
      message: `Failed to parse tag soul document JSON: ${filePath}`,
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    throw new ActionableError({
      goal: `Parse tag soul document for ${pov} / tag "${tag}"`,
      problem: `Invalid JSON in ${filePath}`,
      location: 'soulDocLoader.ts:loadTagSoulDocument',
      nextSteps: ['Check the file for syntax errors'],
    });
  }

  const result = SoulDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const validationSummary = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ActionableError({
      goal: `Validate tag soul document for ${pov} / tag "${tag}"`,
      problem: `Schema validation failed: ${validationSummary}`,
      location: 'soulDocLoader.ts:loadTagSoulDocument',
      nextSteps: ['Fix the validation errors in the tag soul document JSON'],
    });
  }

  // Relaxed pov check for tag souls: warn, don't throw (tag soul files are researcher-authored).
  if (result.data.pov !== pov) {
    getGlobalRecorder()?.record({
      type: 'system.info',
      component: 'soul-doc-loader',
      level: 'warn',
      message: `Tag soul pov mismatch — file has pov "${result.data.pov}", expected "${pov}" (tag "${tag}"). Proceeding anyway.`,
    });
  }

  _tagCache.set(cacheKey, result.data);
  _provenanceCache.set(cacheKey, {
    file: filePath,
    sha: createHash('sha256').update(raw).digest('hex').slice(0, 16),
  });
  return result.data;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getSoulDocument(pov: CharacterId, tag?: string): SoulDocument {
  if (!tag) {
    const docs = loadSoulDocuments();
    return docs.get(pov)!;
  }
  return loadTagSoulDocument(pov, tag);
}

/**
 * Resolve the effective soul for a speaker, replacing the base soul entirely when a tag is present.
 * Returns the soul (as PovInfo, matching the POVER_INFO shape) plus file + sha provenance.
 *
 * When no tagSelection: returns POVER_INFO[speaker] with provenance from the base soul loader.
 * When tagSelection present: loads the tag soul file, which replaces the base soul entirely (t/3957).
 */
export function resolvePoverInfo(
  speaker: Exclude<SpeakerId, 'user'>,
  tagSelection?: TagSelection,
): { soul: PovInfo; soulProvenance: SoulProvenance } {
  if (!tagSelection) {
    loadSoulDocuments(); // ensure provenance cache is populated
    const provenance = _provenanceCache.get(speaker) ?? { file: '(static-import)', sha: '' };
    return { soul: POVER_INFO[speaker], soulProvenance: provenance };
  }

  const tagDoc = loadTagSoulDocument(speaker, tagSelection.tag);
  const provenance = _provenanceCache.get(`${speaker}:${tagSelection.tag}`)!;
  return { soul: tagDoc as unknown as PovInfo, soulProvenance: provenance };
}

export function clearSoulDocCache(): void {
  _baseCache = null;
  _tagCache.clear();
  _provenanceCache.clear();
}
