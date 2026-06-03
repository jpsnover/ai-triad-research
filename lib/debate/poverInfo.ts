// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { SpeakerId, PovInfo } from './types.js';
import accSoulDoc from './soul-docs/accelerationist.soul.json' with { type: 'json' };
import safSoulDoc from './soul-docs/safetyist.soul.json' with { type: 'json' };
import skpSoulDoc from './soul-docs/skeptic.soul.json' with { type: 'json' };

export const POVER_INFO: Record<Exclude<SpeakerId, 'user'>, PovInfo> = {
  accelerationist: accSoulDoc as unknown as PovInfo,
  safetyist: safSoulDoc as unknown as PovInfo,
  skeptic: skpSoulDoc as unknown as PovInfo,
};
