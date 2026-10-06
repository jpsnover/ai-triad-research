// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// An UNTAGGED public Inquiry share, used to prove the tag-scope change (t/3983) leaves untagged shares
// byte-identical. publicInquiryShare.untagged.html is this doc rendered by PublicInquiryShareContent on
// origin/main 7f777165, captured BEFORE the t/3983 change (Quality TL condition, t/3983#2).

import type { PublicInquiryShare } from '@lib/inquiry';

export const UNTAGGED_SHARE = {
  version: 1 as const,
  request: { question: 'What counts as an AI harm?', fidelity: 'standard' as const },
  synthesizedHeadline: 'Camps converge on outcome, diverge on intent.',
  campVerdicts: [],
  convergences: [],
  evidenceLayers: [],
  unresolvedGaps: [{ description: 'Whether diffuse harms count.', confidence: 'low' }],
  calibration: [],
  derivation: { fidelity: 'standard' as const, models: { debaters: 'claude-sonnet-5', evaluator: 'claude-opus-5' }, rounds: 4 },
  grounding: { nodesByCamp: {} },
  singleRunCaveat: 'This is one run of a stochastic process, not a repeated-measures finding.',
} as unknown as PublicInquiryShare;
