// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId } from '../../types/debate';
import { resolveSpeaker } from '../shared/SpeakerIdentity';

// ── Speaker helpers ──────────────────────────────────────
// Thin delegates to the single speaker resolver (t/2256). resolveSpeaker is the
// sole reader of the debater label/color lookup — behavior here is preserved for
// every input these signatures allow (the three POVs plus system/user/document/
// moderator); resolveSpeaker's additional persona-alias acceptance is unreachable
// through these narrowed types, so no call site is silently widened.
//
// These live in their own module (re-exported by ./utils) so debate-workspace test
// files that vi.mock('./utils') to stub labels cannot bleed a stubbed speakerLabel
// into utils.test.ts under CI's threads pool (t/2256).
//
// Not directly unit-tested: any test that imports these delegates pulls in the
// ./utils re-export chain, and a sibling's vi.mock('./utils') then contaminates the
// resolver up that chain under CI's threads pool (t/2256 — it flaked even a direct
// resolveSpeaker assertion). The label/color contract is instead fully covered where
// it actually lives: resolveSpeaker in ../shared/SpeakerIdentity.test.tsx.

export function speakerLabel(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string {
  return resolveSpeaker(speaker).label;
}

export function speakerColor(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string | undefined {
  return resolveSpeaker(speaker).color;
}
