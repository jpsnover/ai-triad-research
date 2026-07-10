# Pending upstream Orca bug report — approved by Jeffrey 2026-07-04, submission blocked

**Status:** submit_feedback failed: "requires an active beta license token. File not found at ~/.orca/beta/license.json — reconnect to the internet so the heartbeat client can refresh."
**Action:** retry `submit_feedback` (type: bug, severity: high, user_confirmed: true) once the license token refreshes. Payload below, verbatim as approved.

**Title:** Orca sync overwrites working-tree AGENTS.md with stale cached content on settings events

**Description:**
Orca's workspace sync writes AGENTS.md files from an internal cache whenever a settings event occurs (observed triggers: session model selection, DND toggle). The cache lags behind commits made to the overlay repo (.orca-git), so any settings change silently reverts the working-tree AGENTS.md to stale content — in our case undoing an owner-approved process rule and days of documentation corrections while the overlay history remained intact.

Impact: every agent that reads AGENTS.md between the sync and manual restore operates on stale instructions, with no error or signal. In a multi-agent workspace this silently degrades fleet behavior.

Expected: sync should refresh its AGENTS.md cache from the overlay repo (or the current working tree) before writing, or not write AGENTS.md at all when only .orca.yaml changed.

Detected 2026-07-04 in workspace ai-triad-research; diagnosed by comparing working tree against overlay HEAD (`git --git-dir=.orca-git diff`). Recovery: `git --git-dir=.orca-git --work-tree=. checkout -- <AGENTS.md paths>`.

**Reproduction steps:**
1. In a workspace with the overlay-repo pattern (.orca-git tracking AGENTS.md), commit a change to AGENTS.md via the overlay (working tree and overlay HEAD in sync).
2. Trigger any settings event — e.g., toggle an agent's DND in the dashboard, or change the session model.
3. Observe: Orca sync rewrites .orca.yaml (expected) AND working-tree AGENTS.md files (unexpected), restoring content from a cache that predates the overlay commits.
4. `git --git-dir=.orca-git --work-tree=. status` shows AGENTS.md modified; diff shows the stale revert.

---

## Bug 2: Ping delivery HEAD-truncation on long messages

**Reported by:** Technical Lead (p/63#27), 2026-07-06
**Severity:** medium (workaround exists: split at ~800 chars)

**Title:** Long pings lose their beginning — HEAD-truncated rather than tail-truncated

**Description:**
A ping of ~1,700 chars (4 numbered items) sent from TL to Sage (p/8#39) arrived with its beginning missing — Sage received a fragment starting mid-word ("ktree off fresh origin/main", middle of item 3) through the end. This is a HEAD truncation, not a tail cap. Tail truncation would suggest a length ceiling; losing the head suggests a buffer-handling issue (e.g., chunked delivery dropping the first segment, or a ring-buffer overwrite).

Expected: full message delivered, or if length-capped, trailing content omitted with a signal.

Workaround in use: splitting long pings into ~800-char segments.

**Reproduction:**
Send a ping body of ~1,700 chars with content structured across 4+ numbered items. Recipient receives a fragment beginning mid-word partway through the content, preceded by nothing.

**Second instance (2026-07-06, confirms reproducibility + narrows threshold):**
p/8#43 (~1,100 chars): recipient (Sage) processed only the TAIL of the message (the final paragraph) and explicitly reported never receiving the head (the main content item). Same signature — head lost, tail delivered. Threshold is therefore between ~800 chars (delivered intact) and ~1,100 chars (truncated). Fleet workaround tightened: split pings at ~700 chars.

**Third instance (2026-07-10, different sender/recipient pair — confirms not user-specific):**
p/47#79 (Diagnostics→TL, long structured diagnosis with FR line citations): TL received only `"ration 403 FR events - t/1464..."` — a tail fragment. TL had to pull full context from the ticket directly. Sender and recipient differ from instances 1 and 2, ruling out a per-user delivery issue. Tracked in t/1465. Fleet guard added: `warn-ping-length` feedback rule (PreToolUse/send_ping, context-type) warns all agents to stay under ~700 chars.
