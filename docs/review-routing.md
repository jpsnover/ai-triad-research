# Review Routing & Queue Mechanics

**Status:** Canonical (shared)
**Owner:** Technical Lead
**Last updated:** 2026-07-16

Full mechanics for how implementation reviews are routed, queued, and handled in the multi-agent fleet. The Tech Lead AGENTS.md keeps only the one-line load-bearing routing rule inline and points here for the detail.

## Review Routing — Quality (TL) vs Main (TL)

To reduce review queue bottleneck, **Quality (Technical Lead)** handles routine implementation reviews. Route directly to Main (TL) only when escalation criteria are met.

Three parallel peer reviewers share the routine review queue: **Quality (Technical Lead)**, **Quality2 (Technical Lead)**, **Quality3 (Technical Lead)**. Assign round-robin or pick the one with the shortest queue. All three have identical scope and escalation rules.

**Route to Quality (TL / Quality2 / Quality3):**
- Single-role implementation ticket (all changes within one scope)
- Follows an existing pattern (CRUD endpoint, bridge method, PS cmdlet, test addition, UI-only renderer change)
- No new cross-role interfaces introduced
- No data model changes (taxonomy schema, debate output shape, organization model)
- No auth/security surface changes

**Route to Main (TL) — or Quality reviewer escalates here:**
- Novel architecture (no existing pattern playbook covers it)
- New cross-role interface or shared type changes
- Data model or schema changes
- Auth gate or security surface changes
- ADR creation or amendment
- Conflict between agents requiring arbitration
- Quality reviewer pings Main (TL) when a review exceeds their scope

## Async Review (implement-then-review)

For **low-risk tickets** — single-scope, no new public API, no data model changes, follows a known pattern — agents MAY implement first without waiting for design approval, then submit to a Quality reviewer after the verify gate passes. This lets the agent pick up their next ticket while review is in flight.

**Low-risk qualify criteria (all must be true):**
- All changes within agent's own scope
- No new exports, bridge methods, cmdlets, or REST endpoints
- No schema or data model changes
- No auth surface changes
- Verify gate passes on committed code

**How to use async review:**
1. Begin implementation, noting in the ticket: "Using async review — low-risk criteria met."
2. Commit code, run verify gate, note SHA.
3. Ping a Quality reviewer with the ticket key.
4. Pick up next ticket. If reviewer requests changes, fix before that ticket's Done transition.

Agents must NOT use async review for novel architecture, cross-scope work, or anything a self-cert playbook explicitly excludes.

## Review Queue Mechanics (required for all design reviews)

When a worker posts a design and routes it for Quality review, they must do **three things** — not just ping:

1. **Transition the ticket to "In Review"** status.
2. **Reassign the ticket to the Quality instance receiving the review** (`Quality (Technical Lead)`, `Quality2`, or `Quality3` — round-robin). This is the queue: `list_tickets(all: false)` on a Quality instance returns only tickets assigned to it.
3. **Ping** Quality with the ticket ref.

Quality instance on receiving a review:
- Picks it up via `list_tickets(all: false)` at session start (standard queue check).
- Posts review comment on the ticket.
- **Reassigns the ticket back to the worker** and pings them.

**Why this matters:** without reassignment, Quality instances have an invisible queue and no mechanism to notice stalled reviews. A ping can be missed when a session context expires; a ticket assigned to you cannot.
