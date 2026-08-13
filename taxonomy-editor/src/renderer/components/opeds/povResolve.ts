// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { POV_META, type PovMeta, type PovMetaKey } from '@lib/electron-shared/povMeta';
import { type CampKey, povToCamp } from '../shared/CampGlyph';

// Persisted op-ed voices carry the SHORT camp code in `OpEdMember.pov` — the create
// flow writes `'acc'`/`'saf'`/`'skp'`, not the full PovKey (`'accelerationist'`…) that
// POV_META is keyed by. `pov` is *typed* PovKey, so tsc never flagged the drift; it was
// masked at runtime by the t/2605 `set.opeds` crash until that landed. A live desktop
// smoke of the t/2603 reveal then hit `POV_META[pov].label` → `undefined.label` on the
// first real set. These resolvers accept BOTH forms and fall back safely so a legacy or
// unknown code renders a neutral chip instead of crashing the whole tab (t/2605 follow-up).

const CAMP_TO_POV: Record<string, PovMetaKey> = {
  acc: 'accelerationist',
  saf: 'safetyist',
  skp: 'skeptic',
  sit: 'situations',
};

// Neutral chip for an unrecognized code — never throws, keeps the row/reader rendering.
const FALLBACK_META: PovMeta = {
  label: 'Unknown',
  shortLabel: '—',
  color: 'var(--text-muted)',
  cssVar: '--text-muted',
  prefix: '',
};

/** Normalize a persisted pov value (short camp code OR full PovKey) to a POV_META key. */
export function resolvePovMetaKey(pov: string): PovMetaKey | undefined {
  if (pov in POV_META) return pov as PovMetaKey;
  return CAMP_TO_POV[pov];
}

/** POV_META entry for a persisted pov value, with a neutral fallback (never undefined). */
export function resolvePovMeta(pov: string): PovMeta {
  const key = resolvePovMetaKey(pov);
  return (key && POV_META[key]) || FALLBACK_META;
}

/** Short camp key (for the glyph) from a persisted pov value, or undefined if unknown. */
export function resolveCampKey(pov: string): CampKey | undefined {
  const key = resolvePovMetaKey(pov);
  return key ? povToCamp(key) : undefined;
}
