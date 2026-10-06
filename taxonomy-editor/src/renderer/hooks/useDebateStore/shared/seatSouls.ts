// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Tag-aware souls for debate seats (t/3975). A seat tagged in `session.seat_tags` debates as its tag
// soul; lib's prompt builders take that soul (and the opponents') explicitly (t/3988), because they
// otherwise look personas up by POV key and would emit the BASE soul next to a tagged personality.
//
// Browser-safe on purpose: resolvePoverInfo comes from tagSoulRegistry, never soulDocLoader
// (Node-only; the renderer-not-to-soulDocLoader depcruise rule enforces this, t/3975).

import { resolvePoverInfo } from '@lib/debate/tagSoulRegistry';
import { POV_KEYS } from '@lib/debate/types';
import type { PovInfo, SpeakerId } from '@lib/debate/types';
import type { DebateSession, TagSelection } from '@lib/debate/types/session';

type Seat = Exclude<SpeakerId, 'user'>;

/** The seat's tag selection, derived from `session.seat_tags` (the pipeline never reads seat_tags). */
export function seatTagSelection(session: Pick<DebateSession, 'seat_tags'> | null | undefined, speaker: Seat): TagSelection | undefined {
  const seat = session?.seat_tags?.[speaker];
  return seat ? { tag: seat.pov_tag, mode: seat.tag_mode } : undefined;
}

export interface SeatSouls {
  /** This speaker's soul: the tag soul when its seat is tagged, else the base soul. Label and pov are
   *  always the base soul's (resolvePoverInfo enforces it), so label/pov reads are unaffected. */
  soul: PovInfo;
  /** Every other debater's soul. Omitted when no seat in the session is tagged, so untagged debates
   *  hand lib exactly what they did before t/3975 and their prompts stay byte-identical. */
  opponentSouls?: Partial<Record<SpeakerId, PovInfo>>;
}

/** Resolve the souls a prompt for `speaker` needs. Throws (lib ActionableError) if a seat names a tag
 *  whose soul is not in the registry: a scoped debate must not silently run as the base persona. */
export function seatSouls(session: Pick<DebateSession, 'seat_tags'> | null | undefined, speaker: Seat): SeatSouls {
  const soul = resolvePoverInfo(speaker, seatTagSelection(session, speaker)).soul;
  const anyTagged = Object.keys(session?.seat_tags ?? {}).length > 0;
  if (!anyTagged) return { soul };
  const opponentSouls: Partial<Record<SpeakerId, PovInfo>> = {};
  for (const other of POV_KEYS as readonly Seat[]) {
    if (other !== speaker) opponentSouls[other] = resolvePoverInfo(other, seatTagSelection(session, other)).soul;
  }
  return { soul, opponentSouls };
}
