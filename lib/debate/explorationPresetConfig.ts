// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Browser-safe exploration preset config (no DebateEngine or Node.js deps).
// Extracted from explorationPreset.ts so renderer code can import the
// constant without pulling in debateEngine → calibrationOptimizer → node:url.

import type { DebateConfig } from './debateEngine.js';
import type { DebateSession } from './types.js';

export const EXPLORATION_PRESET: Partial<DebateConfig> = {
  responseLength: 'brief',
  maxTotalRounds: 8,
  pacing: 'quick',
  enableClarification: false,
  enableWisdomEvaluation: false,
  wisdomAutoReframe: false,
  enableProbing: false,
  temperature: 0.8,
  turnValidation: { maxRetries: 1 },
  protocolId: 'exploration',
};

export interface ExploreFirstResult {
  exploration: DebateSession | null;
  production: DebateSession;
}
