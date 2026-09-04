// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Community op-ed public-share registry (t/3315, Pattern-A publish-on-share).
//
// Mirrors the per-user opedShareStore pattern but community-scoped: one stable
// shareId per community item (any authed user can mint; the same shareId is
// returned to all callers — no per-user copies). Registry tracks submittedBy
// for admin/submitter revoke-auth (the public copy is always anonymous).
//
// Atomicity: mint uses write-first-then-verify. Two concurrent callers both
// write their shareId; whoever wins the last writeFile also wins the registry
// re-read check. The loser reads the winner's shareId and returns it — never
// writing a public projection — so no orphan public files can survive a revoke.

import { randomUUID } from 'crypto';
import { resolveDataPath } from '../config.js';
import { getUserContentBackend, assertSafeId } from '../storage/fileIO.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { log } from '../logger.js';
import { getGlobalRecorder } from '../../../../lib/flight-recorder/index.js';

const COMMUNITY_SHARE_REGISTRY = 'community/oped-shares.json';
const MAX_MINT_ATTEMPTS = 5;

function registryPath(): string {
  return resolveDataPath(COMMUNITY_SHARE_REGISTRY);
}

export interface CommunityShareEntry {
  shareId: string;
  submittedBy: string;
}

type Registry = Record<string, CommunityShareEntry>;

async function readRegistry(): Promise<Registry> {
  const raw = await getUserContentBackend().readFile(registryPath());
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Registry;
  } catch (err) {
    log.server.warn({ err }, 'community oped share registry: parse failed — treating as empty');
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'community', level: 'warn',
      message: 'community oped share registry parse failed — treated as empty',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return {};
  }
}

async function writeRegistry(reg: Registry): Promise<void> {
  await getUserContentBackend().writeFile(registryPath(), JSON.stringify(reg, null, 2));
}

/** Look up the share entry for a community oped by its community item id. Returns null if not shared. */
export async function getCommunityOpedShareEntry(id: string): Promise<CommunityShareEntry | null> {
  assertSafeId(id, 'community oped id');
  const reg = await readRegistry();
  return reg[id] ?? null;
}

/**
 * Idempotent mint: return the stable shareId for a community oped, creating one if none exists.
 *
 * Write-first-then-verify: the registry is written BEFORE the caller writes the public
 * projection. Two concurrent minters both write their shareId; the last writeFile wins.
 * The winner's shareId appears in the post-write re-read; the loser reads it and returns
 * it without triggering a public projection write — so no orphan public files are created
 * that could survive a subsequent admin revoke.
 */
export async function mintCommunityOpedShare(id: string, submittedBy: string): Promise<string> {
  assertSafeId(id, 'community oped id');

  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const reg = await readRegistry();

    // Idempotent: already minted — return the stable shareId.
    if (reg[id]) return reg[id].shareId;

    const shareId = randomUUID();
    await writeRegistry({ ...reg, [id]: { shareId, submittedBy } });

    // Verify we won. On the filesystem backend, writeFile is tmp+rename (atomic); last rename
    // wins. The loser reads the winner's shareId here and returns it — no projection written.
    const verified = await readRegistry();
    if (verified[id]?.shareId === shareId) return shareId;
    if (verified[id]?.shareId) return verified[id].shareId;

    // Entry still absent after write — unexpected; retry.
    log.server.warn({ attempt, id }, 'community oped share: registry entry absent after write, retrying');
  }

  throw new ActionableError({
    goal: 'Mint a stable public shareId for a community op-ed',
    problem: `Registry write did not converge after ${MAX_MINT_ATTEMPTS} attempts — extreme concurrent load or storage write loop`,
    location: 'communityOpedShares.ts mintCommunityOpedShare',
    nextSteps: ['Retry the request.', 'If persistent, check storage backend health and concurrent writer count.'],
  });
}

/**
 * Remove a community oped share from the registry.
 * Returns the removed entry (shareId + submittedBy) so the caller can delete the public
 * projection (public/opeds/{shareId}.json) via Server Storage, or null if no share exists.
 * Does NOT delete the public projection itself — that is the route handler's responsibility.
 */
export async function revokeCommunityOpedShare(id: string): Promise<CommunityShareEntry | null> {
  assertSafeId(id, 'community oped id');
  const reg = await readRegistry();
  const entry = reg[id];
  if (!entry) return null;
  const newReg: Registry = { ...reg };
  delete newReg[id];
  await writeRegistry(newReg);
  return entry;
}
