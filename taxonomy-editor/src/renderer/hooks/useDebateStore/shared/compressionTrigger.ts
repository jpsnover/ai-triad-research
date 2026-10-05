// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// When to auto-compress older transcript into a context summary (Phase 8). Shared by the two
// triggers so their thresholds can't drift (t/3917):
//   - during an automatic run, the run-lease holder's loop compresses between rounds. The
//     owner window may not have DebateWorkspace mounted at all; under Option A a popped-out
//     debate is driven by the main window, which shows only a placeholder.
//   - outside a run, DebateWorkspace's effect compresses as before.

interface CompressibleDebate {
  transcript: ReadonlyArray<{ id: string }>;
  context_summaries: ReadonlyArray<{ up_to_entry_id: string }>;
}

const MIN_TRANSCRIPT = 16;
const MIN_UNCOMPRESSED = 8;
const KEEP_RECENT = 8;

export function isCompressionDue(debate: CompressibleDebate): boolean {
  if (debate.transcript.length < MIN_TRANSCRIPT) return false;
  const last = debate.context_summaries[debate.context_summaries.length - 1];
  const lastSummaryIdx = last ? debate.transcript.findIndex(e => e.id === last.up_to_entry_id) : -1;
  return debate.transcript.length - (lastSummaryIdx + 1) - KEEP_RECENT >= MIN_UNCOMPRESSED;
}
