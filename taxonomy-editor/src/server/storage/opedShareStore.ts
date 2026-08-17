// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Op-ed public-share storage (t/2727; design t/2723#3, SO-approved e/106#2).
//
// Pattern A — publish-on-share. On share, the owner's op-ed set is projected to a
// POSITIVE field allowlist and written to a fixed, USER-AGNOSTIC location
// (public/opeds/{shareId}.json). The public read path reads ONLY from there and
// NEVER touches users/**, so there is no code path from the unauthenticated surface
// into private user storage. The URL key is a fresh random shareId (≠ the storage
// setId) so a leaked link is revoked for good by delete + re-share.

import path from 'path';
import { randomUUID } from 'crypto';
import { resolveDataPath } from '../config.js';
import type { OpEdSet, OpEdMember } from '../../../../lib/oped/types.js';
import { getStorageUserId, isAnonymousUser } from '../security/userContext.js';
import { getUserContentBackend, assertSafeId } from './fileIO.js';
import { loadOpedSet } from './opedStore.js';
import { log } from '../logger.js';

// Public copies live under a fixed, user-agnostic prefix — NEVER under users/{id}/.
const PUBLIC_OPEDS_DIR = 'public/opeds';
// Owner-scoped registry mapping setId → shareId, so un-share/re-share can find the
// public copy without exposing the setId in the public URL.
const SHARE_REGISTRY_FILE = 'oped-shares.json';

function publicOpedPath(shareId: string): string {
  return path.join(resolveDataPath(PUBLIC_OPEDS_DIR), `${shareId}.json`);
}
function shareRegistryPath(): string {
  return path.join(resolveDataPath(`users/${getStorageUserId()}`), SHARE_REGISTRY_FILE);
}

// ── Public wire shape — POSITIVE allowlist, the info-leak control ─────────────
// Only these fields ever reach the public copy at rest. Generation params (model,
// prompts, thesis, authorBio, newsHook), the pitch-email draft, grounding internals,
// userId, and the storage set_id are all STRIPPED — never a spread/denylist.
export interface PublicOpEdMember {
  pov: string;
  status: string;
  headline: string;
  subtitle: string;
  body: string;
  wordCount: number;
}
export interface PublicOpEd {
  schema_version: 1;
  shareId: string;
  topic: string;
  outlet: string | null;
  created_at: string;
  opeds: PublicOpEdMember[];
}

/** Build the public projection by EXPLICIT field — never `{...set}` or a delete-keys denylist. */
export function projectPublicOpEd(set: OpEdSet, shareId: string): PublicOpEd {
  return {
    schema_version: 1,
    shareId,
    topic: String(set.topic ?? ''),
    outlet: set.params?.outlet ?? null, // editorial context, public-safe
    created_at: String(set.created_at ?? ''),
    opeds: (Array.isArray(set.opeds) ? set.opeds : []).map((m: OpEdMember) => ({
      pov: m.pov,
      status: m.status,
      headline: String(m.headline ?? ''),
      subtitle: String(m.subtitle ?? ''),
      body: String(m.body ?? ''),
      wordCount: typeof m.wordCount === 'number' ? m.wordCount : 0,
    })),
  };
}

async function readShareRegistry(): Promise<Record<string, string>> {
  const raw = await getUserContentBackend().readFile(shareRegistryPath());
  if (raw === null) return {};
  try { return JSON.parse(raw) as Record<string, string>; } catch { /* telemetry — silent by design */ return {}; }
}
async function writeShareRegistry(reg: Record<string, string>): Promise<void> {
  await getUserContentBackend().writeFile(shareRegistryPath(), JSON.stringify(reg, null, 2));
}

/**
 * Publish an owner's op-ed set to a durable public URL. OWNER-ONLY: `loadOpedSet`
 * reads under the caller's `getStorageUserId()` scope, so a set the caller doesn't
 * own (or that doesn't exist) yields null → the route returns an indistinguishable
 * 404. Idempotent: an already-shared set refreshes its existing shareId (no dup copy).
 */
export async function publishOpedShare(setId: string): Promise<{ shareId: string } | null> {
  assertSafeId(setId, 'oped-set id');
  if (isAnonymousUser()) return null; // no durable owner scope to share from
  const set = (await loadOpedSet(setId)) as OpEdSet | null;
  if (!set) return null;

  const reg = await readShareRegistry();
  const existing = reg[setId];
  const shareId = existing ?? randomUUID();
  await getUserContentBackend().writeFile(
    publicOpedPath(shareId),
    JSON.stringify(projectPublicOpEd(set, shareId), null, 2),
  );
  if (!existing) {
    reg[setId] = shareId;
    await writeShareRegistry(reg);
  }
  return { shareId };
}

/**
 * Un-share (owner-only — the registry is owner-scoped): delete the public copy +
 * registry entry. Returns true if a share existed. With the fresh-shareId scheme this
 * is a real revocation — a leaked old link is permanently dead.
 */
export async function unpublishOpedShare(setId: string): Promise<boolean> {
  assertSafeId(setId, 'oped-set id');
  if (isAnonymousUser()) return false;
  const reg = await readShareRegistry();
  const shareId = reg[setId];
  if (!shareId) return false;
  await getUserContentBackend().deleteFile(publicOpedPath(shareId)).catch((err) => {
    log.server.warn({ err, shareId }, 'oped share public-copy delete failed (best-effort)');
  });
  delete reg[setId];
  await writeShareRegistry(reg);
  return true;
}

/**
 * Read a published public op-ed by shareId — the UNAUTHENTICATED path. Reads ONLY
 * from the user-agnostic public dir; never touches users/**. Returns null if not
 * shared or revoked. The file at rest is already the positive projection (written by
 * publishOpedShare), so no private field can be present. shareId shape is validated
 * by the route (invalidRouteParam) before this is called.
 */
export async function loadPublicOpedShare(shareId: string): Promise<PublicOpEd | null> {
  const raw = await getUserContentBackend().readFile(publicOpedPath(shareId));
  if (raw === null) return null;
  try { return JSON.parse(raw) as PublicOpEd; } catch { /* telemetry — silent by design */ return null; }
}
