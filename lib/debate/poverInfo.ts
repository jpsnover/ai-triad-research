// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { SoulDocumentSchema, type SoulDocument } from './soulDocSchema.js';
import type { SpeakerId, PovInfo } from './types.js';
import accSoulDoc from './soul-docs/accelerationist.soul.json' with { type: 'json' };
import safSoulDoc from './soul-docs/safetyist.soul.json' with { type: 'json' };
import skpSoulDoc from './soul-docs/skeptic.soul.json' with { type: 'json' };

const _accSoul = SoulDocumentSchema.parse(accSoulDoc);
const _safSoul = SoulDocumentSchema.parse(safSoulDoc);
const _skpSoul = SoulDocumentSchema.parse(skpSoulDoc);

function soulDocToPovInfo(doc: SoulDocument): PovInfo {
  return {
    label: doc.label,
    pov: doc.pov,
    color: doc.color,
    personality: doc.personality,
    voice: doc.voice,
    anti_patterns: doc.anti_patterns,
    boundaries: doc.boundaries,
    value_hierarchy: doc.value_hierarchy,
    epistemic_stance: doc.epistemic_stance,
  };
}

export const POVER_INFO: Record<Exclude<SpeakerId, 'user'>, PovInfo> = {
  accelerationist: soulDocToPovInfo(_accSoul),
  safetyist: soulDocToPovInfo(_safSoul),
  skeptic: soulDocToPovInfo(_skpSoul),
};
