// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Detects fabricated dated-event markers in op-ed ledes produced when newsHook
 * was empty. The empty-hook fallback (t/2721) tells the model not to invent
 * events; this guard is the runtime enforcement layer — it scans the first
 * paragraph of generated output and flags any slip-through.
 *
 * Canonical form — stipulated in metric-provenance-register §5 (t/2726).
 */
export const FABRICATED_LEDE_GUARD =
  /\b(this week|next week|yesterday|pending (vote|ruling)|newly? (proposed|drafted) (rule|regulation)|pre-?clearance)\b/i;
