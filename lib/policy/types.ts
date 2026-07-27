// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** A policy action (pol-*) from taxonomy/Origin/policy_actions.json. */
export interface PolicyAction {
  id: string;                 // pol-*
  action: string;             // the policy statement; this file has no separate title field
  status?: string;
  tags?: string[];
  source_povs?: string[];     // which camps propose it
  member_count?: number;
  real_world_refs?: unknown[];
}
