// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { z } from 'zod';

/**
 * Runtime validation for the community-submit IPC payload (t/2986).
 *
 * Extracted from communityHandlers so the type-enum contract is testable WITHOUT
 * importing electron. This enum is the RUNTIME gate — it MUST stay in sync with the
 * client bridge type (renderer/bridge/types.ts `communitySubmit`) and the server
 * accept set (server/community/community.ts `submitToCommunity`). The drift that
 * broke op-ed sharing (t/2986) was this enum missing 'oped' while the TS types
 * already listed it, so a `type: 'oped'` share was rejected at the IPC boundary.
 */
export const COMMUNITY_SUBMISSION_TYPES = ['chat', 'debate', 'oped'] as const;

export const communitySubmitPayloadSchema = z.object({
  type: z.enum(COMMUNITY_SUBMISSION_TYPES),
  data: z.unknown(),
  note: z.string().optional(),
});
