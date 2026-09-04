// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Community op-ed public-share projection store (t/3315).
//
// Pattern-A publish-on-share for COMMUNITY items. Reuses projectPublicOpEd from
// opedShareStore for the positive-allowlist projection — the registry (community-
// scoped, atomic RMW) is owned by Server Community. This store owns only the
// public-copy write/delete for community items at public/opeds/{shareId}.json,
// the same user-agnostic location as own-op-ed shares.
//
// Privacy: community_metadata, submitted_by_display, original_id, submitted_at
// are ALL stripped by the positive allowlist (never a spread/denylist).
// TL t/3315#9 condition 4: non-empty guard prevents a false-empty read from
// minting a vacuous public copy (ADR-001 class, t/2648).

import path from 'path';
import type { OpEdSet } from '../../../../lib/oped/types.js';
import { ActionableError } from '../../../../lib/debate/errors.js';
import { resolveDataPath } from '../config.js';
import { assertSafeId, getUserContentBackend } from './fileIO.js';
import { projectPublicOpEd, type PublicOpEd } from './opedShareStore.js';

const PUBLIC_OPEDS_DIR = 'public/opeds';

function publicCommunityOpedPath(shareId: string): string {
  return path.join(resolveDataPath(PUBLIC_OPEDS_DIR), `${shareId}.json`);
}

// Community items extend OpEdSet with submission-context fields.
// We name them explicitly so the negative test can assert they are absent
// from the public projection. projectPublicOpEd strips them via positive allowlist.
export type CommunityOpEdItem = OpEdSet & {
  community_metadata?: unknown;
  submitted_by_display?: string;
  original_id?: string;
  submitted_at?: string;
};

/**
 * Project a community op-ed item through the positive allowlist and write the
 * resulting public copy to public/opeds/{shareId}.json. The registry (community-
 * scoped idempotent shareId) is managed by Server Community — this function writes
 * ONLY the public projection.
 *
 * TL t/3315#9 condition 4: throws BEFORE projecting if the item is missing required
 * fields — prevents minting a vacuous public copy from a silent-empty backend read.
 */
export async function writePublicCommunityOpEd(
  item: CommunityOpEdItem,
  shareId: string,
): Promise<void> {
  assertSafeId(shareId, 'community oped shareId');

  if (!item.topic || !Array.isArray(item.opeds) || item.opeds.length === 0) {
    throw new ActionableError({
      goal: 'Publish community op-ed public copy',
      problem: 'Community op-ed item is empty or missing required fields — will not mint a vacuous public copy.',
      location: 'communityOpedShareStore.writePublicCommunityOpEd',
      nextSteps: [
        'Verify getCommunityOpEd returned a valid, non-empty item',
        'Check for false-empty reads from the GitHub API backend (t/3300)',
      ],
    });
  }

  const projection = projectPublicOpEd(item as OpEdSet, shareId);
  await getUserContentBackend().writeFile(
    publicCommunityOpedPath(shareId),
    JSON.stringify(projection, null, 2),
  );
}

/**
 * Delete a community op-ed's public copy (revocation path). Best-effort — does
 * not throw on missing file. Called after the registry entry is cleared so the
 * public copy can no longer be resolved by a shareId.
 */
export async function deletePublicCommunityOpEd(shareId: string): Promise<void> {
  assertSafeId(shareId, 'community oped shareId');
  await getUserContentBackend().deleteFile(publicCommunityOpedPath(shareId)).catch(() => {
    // best-effort: the file may already be absent or revoked
  });
}

export type { PublicOpEd };
