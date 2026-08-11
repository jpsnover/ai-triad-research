# Usage Analytics Instrumentation — Hierarchical Engagement Tracking

**Ticket:** t/2463 (proposal phase) · builds on t/2460 (pseudonymous cookie ID)
**Last updated:** 2026-08-11
**Author:** Design (Orca)
**Status:** Proposal — for owner + Tech Lead review before decomposition

---

## 0. TL;DR

We want to know how users engage with the web app — per user and in aggregate — at four
nested levels: **tool → POV camp → category → node**. A usage-analytics pipeline
**already exists end-to-end** (renderer emitter → `POST /api/analytics/event` → daily
NDJSON / Azure Append Blob → `GET /api/analytics/query` aggregation). What is missing is
**dwell time** and the **hierarchy roll-up**. Today we emit point-in-time transitions
(`node.select`, `tab.switch`) with no duration.

This proposal adds **one new client concept — a *visit* with an *engaged duration*** —
and rolls it up for free by parsing the node-ID hierarchy at query time. It is a focused
extension of existing plumbing, not a new subsystem.

The intellectual core is the **engagement heuristic** (§3): separating "actively engaged"
from "opened a tab and walked away," with a hard per-visit cap so a misfiring heuristic
can never distort the totals.

---

## 1. Background: what exists today

| Layer | File | What it does |
|---|---|---|
| Renderer emitter | `src/renderer/lib/analyticsEmitter.ts` | Web-only. Buffers events, flushes to server every 30s + on `beforeunload` (`sendBeacon`). **Already subscribes to the Zustand store** and auto-emits `tab.switch`, `node.select`, `panel.open`. |
| Ingest endpoint | `src/server/routes/session.ts:80` (`POST /api/analytics/event`) | Validates + `analytics.appendEvents`. |
| Storage | `src/server/community/analytics.ts` | `AnalyticsEvent {user, session_id, timestamp, event_type, category, detail, duration_ms}`. Daily NDJSON (FS) or Azure Append Blob. Retention pruning. |
| Query | `src/server/routes/session.ts:127` (`GET /api/analytics/query`) | `queryAggregated` — active users, sessions, feature usage, event-type counts, AI cost. Raw per-user is admin-gated. |
| Navigation state | `useTaxonomyStore` `taxonomyDataSlice.ts` | `activeTab` + `selectedNodeId` — the pair that answers "user is viewing SKP-BEL-002." |
| Identity | `GET /api/auth/me`, `UserContext` (`security/userContext.ts`) | Real principal or pseudonymous `anon_session_id` cookie (t/2460). |

**Two gaps this proposal fills:**

1. **No dwell time.** `node.select` fires when a node is *chosen*, never records how long
   it stayed the subject. `duration_ms` exists on the event schema but is unused for views.
2. **No hierarchy.** Events carry a flat `category` string (`taxonomy`, `debate`…), not the
   camp → category → node tree the ticket asks to report on.

> **Scope note:** the emitter is **web-only by design** (`isWeb` guard). Electron usage is
> deliberately not tracked. This proposal keeps that boundary.

---

## 2. What to instrument

### 2.1 The key idea — instrument the leaf, roll up by ID

Node IDs already encode the hierarchy: `{pov}-{category}-{NNN}` (e.g. `skp-bel-002`).
We therefore **instrument only the finest grain a user actually focuses** — a node, or a
tab when no node is selected — and derive every higher level by parsing the ID at query
time. No separate camp/category timers, no double counting.

```
tool (root)
└── taxonomy
    └── camp        skp                     ← id.split('-')[0]
        └── category  skp-bel               ← [0]+[1]
            └── node    skp-bel-002         ← full id
└── <non-taxonomy tab>  debate | situations | summaries | …
```

`cc` (cross-camp) and non-BDI content sit at the same tier as the three camps. Non-taxonomy
tabs (Debate, Situations, Summaries, Validation, Organizations, Conflicts, Cruxes) roll up
directly under **tool → tab**, with no category tier.

### 2.2 The unit: a **visit**

A **visit** is a contiguous span during which one *subject* is the active focus.

- **Subject** = the selected node (`selectedNodeId`), or the active tab when no node is
  selected, or an open toolbar panel.
- A visit **opens** when the subject changes (store transition) and **closes** when the
  subject changes again, engagement lapses, the tab is hidden long enough, or the page unloads.
- Each visit yields **two independent measures** (the ticket's explicit requirement):
  - **visit count** — incremented once per visit (was this subject opened at all?);
  - **engaged duration** — accrued only while actually engaged (§3), then capped.

Keeping these separate is what distinguishes *"opened 40 nodes for 2 s each while hunting"*
from *"studied 2 nodes for 15 min each."* Same total time, opposite behavior.

### 2.3 New event: `view.dwell`

Emitted **on visit close** (not on open — we only know duration at the end). Reuses the
existing schema; hierarchy travels in `detail`, engaged time in the existing `duration_ms`
so the current aggregation already sees it.

```jsonc
{
  "event_type": "view.dwell",
  "category":   "taxonomy",          // or the tab id for non-taxonomy subjects
  "duration_ms": 42300,              // = engaged_ms (capped); existing field, reused
  "detail": {
    "subject_type": "node",          // node | tab | panel
    "subject_id":   "skp-bel-002",   // node id, or tab id, or panel id
    "pov":          "skp",           // parsed; null for non-taxonomy
    "cat":          "bel",           // parsed; null for tab/panel
    "tab":          "skeptic",       // active tab at visit time
    "engaged_ms":   42300,
    "wall_ms":      58000,           // raw end−start, for QA/ratio; NOT the reported metric
    "engaged":      true,            // engaged_ms ≥ ENGAGED_MIN (a real read, not a glance)
    "capped":       false,           // true if engaged_ms hit MAX_ENGAGED_MS
    "close_reason": "subject_change" // subject_change | idle | hidden | unload
  }
}
```

We keep `session.start` / `session.end` / `node.select` / `tab.switch` as-is — cheap
breadcrumbs. `view.dwell` is the new metric-bearing event. (Optional cleanup: once
`view.dwell` lands, `node.select` becomes redundant as a metric and can stay purely as a
funnel breadcrumb.)

### 2.4 Signals the client must capture

| Signal | Source | Used for |
|---|---|---|
| Subject change | `useTaxonomyStore.subscribe` on `activeTab`, `selectedNodeId`, `toolbarPanel` (already wired) | open/close visits |
| Interaction pulse | throttled `pointermove`, `keydown`, `scroll`, `wheel`, `click` | reset idle timer → "actively engaged" |
| Tab visibility | `visibilitychange` / `document.hidden` | pause engaged accrual when backgrounded |
| Page unload | `beforeunload` (already wired) | flush the open visit via `sendBeacon` |

No content is captured — only timing and subject IDs.

---

## 3. The engagement heuristic (the hard part)

**Goal:** engaged duration should count time the user is *actually working with* a subject,
not time a tab sat open while they got coffee — and it must be *impossible* for a misfire to
blow up the totals.

### 3.1 Engaged vs idle

Engaged time accrues only while **BOTH** hold:

1. **Visible** — `document.hidden === false` (tab is foregrounded), and
2. **Recently active** — last interaction pulse within `IDLE_TIMEOUT_MS`.

We maintain an **engaged accumulator** per open visit. On every state transition
(visible↔hidden, active↔idle) we add the just-ended engaged span to the accumulator. An
idle timer (reset on each interaction pulse) fires the active→idle transition. This means we
do **not** need a busy polling loop — engaged time is computed from transition timestamps.

```
visit engaged_ms = Σ spans where (visible AND last_pulse within IDLE_TIMEOUT_MS)
```

- **"Visited then went elsewhere quickly"** → the visit closes on subject change after a few
  seconds; `engaged_ms` is small, `engaged:false`. Counted as a visit, not as engaged time.
- **"Left the tab open and walked away"** → no pulses; after `IDLE_TIMEOUT_MS` accrual stops.
  The idle gap is not counted.
- **"Backgrounded the tab"** → `visibilitychange` pauses accrual immediately.

### 3.2 The cap (misfire containment)

Every visit's `engaged_ms` is clamped to **`MAX_ENGAGED_MS`**. If a stuck idle detector or
a synthetic event stream ever kept a visit "engaged" indefinitely, the reported figure can
never exceed the cap, and `capped:true` flags it for QA. A single visit contributing more
than the cap is definitionally a heuristic failure, not real reading.

### 3.3 Thresholds (config-driven, tunable)

Proposed defaults; final values are a Tech-Lead-reviewed tuning question, not a design
absolute. Add to the existing `clientConfig.analytics` block so they ship without a rebuild.

| Constant | Default | Rationale |
|---|---|---|
| `IDLE_TIMEOUT_MS` | 60 000 (1 min) | No interaction for a minute ⇒ likely disengaged. |
| `MAX_ENGAGED_MS` | 1 800 000 (30 min) | Hard cap per visit. Longest plausible single-node read. |
| `ENGAGED_MIN_MS` | 8 000 (8 s) | Below this a visit is a "glance," not an engaged read. |
| `MIN_VISIT_MS` | 1 000 (1 s) | Visits shorter than this are debounced (rapid pass-through). |
| `PULSE_THROTTLE_MS` | 5 000 | Interaction pulses coalesced to ≤1 per 5 s (keeps event cost near zero). |

### 3.4 Reported vs raw

We report **engaged_ms** (capped). `wall_ms` is retained only for QA — the
`engaged_ms / wall_ms` ratio and the `capped` rate are health metrics for the heuristic
itself. If capping is frequent or the ratio is pathological, thresholds get retuned.

---

## 4. What to report on

A new aggregation over `view.dwell` events, exposed via **`GET /api/analytics/engagement`**
(sibling to `/query`; admin-gated for per-user, aggregate open to any authenticated user for
their own totals). Roll-up parses `subject_id` and sums into the tree from §2.1.

Each node in the tree carries, **per user and in aggregate**:

- `visits` — total visits
- `engagedVisits` — visits with `engaged:true`
- `engagedMs` — summed engaged duration
- `uniqueUsers` (aggregate only) — distinct users who visited
- `cappedRate` — QA signal

### 4.1 Report views

1. **Time-with-tool over time** — engaged minutes/day, per user and total (line/area).
2. **Camp distribution** — engaged time split across acc / saf / skp / cc (horizontal bars
   in the camp colors already in the design system). The headline "where does attention go."
3. **Category drill-down** — within a camp, Belief / Desire / Intention split.
4. **Top nodes — two leaderboards, side by side:**
   - *Most engaged time* (depth), and
   - *Most visited* (breadth).
   Showing both surfaces the count-vs-duration distinction the ticket calls for — a node high
   on one and low on the other is a signal (a magnet users bounce off, or a deep-study anchor).
5. **Per-user table** (admin) — total engaged, sessions, top camp, top node, last active.
6. **Heuristic health strip** (admin) — median `engaged/wall` ratio, `cappedRate`, idle-close
   share. So we can trust — and tune — the numbers.

---

## 5. UX — surfacing it

Three surfaces, in priority order. **Recommend shipping 1 first; 2 as a fast follow; 3 held.**

### 5.1 Admin Engagement dashboard (recommended, primary)

A new **admin-only** view alongside the existing admin review stats. Sections map to §4.1
(1–6). Date-range picker, optional user filter. Reuses existing admin gating (`requireAdmin`,
`ADMIN_USERS`) and the design-system chart/table patterns. This is where "understand who is
using what" is answered.

**Placement:** an "Analytics" / "Engagement" entry in the existing admin area (same home as
review stats). No change to the main taxonomy tab bar for non-admins.

### 5.2 "Your Activity" (fast follow, privacy-safe)

A per-user, self-only view — a user sees **their own** engaged-time distribution across camps
and their most-visited nodes. Strictly the caller's own data (no cross-user visibility).
Lives behind a profile/Help menu entry, not in the primary workflow. Gives value back to the
user in exchange for being measured, and is trivially safe (own data only).

### 5.3 Aggregate heat in the taxonomy tree (HELD — do not ship by default)

Technically we *could* tint nodes by aggregate popularity in the main tree. **Recommend
against** for a research tool: surfacing "what everyone else looks at" biases neutral analysis
(popularity contamination) and pulls attention toward the crowd. If ever pursued, admin-only,
off by default, and never in a participant-facing analysis session.

---

## 6. Privacy, identity, and research-integrity notes

- **Identity** rides on t/2460: real principal name, or the pseudonymous `anon_session_id`
  cookie. No new identifiers introduced here.
- **Per-user raw** stays admin-gated (already true for `/query`); aggregate is safe to expose.
- **No content captured** — only timing + subject IDs. Interaction pulses record *that* the
  user acted, never *what* they typed.
- **Retention** reuses `analytics.retentionDays` pruning already in place.
- **Research integrity:** engagement data is *observational* and must not feed back into any
  participant-facing view during analysis (see §5.3). Keep measurement invisible to the
  measured wherever it could bias their judgments.
- **Consent/notice:** confirm the app's existing usage notice covers dwell timing; if not,
  a one-line addition to the anonymous-login / privacy copy. (Flag for owner.)

---

## 7. Volume & feasibility (Tech Lead review needed)

- **Event volume rises** from ~1 transition per navigation to ~1 `view.dwell` per visit —
  same order of magnitude (one dwell replaces one select). Batching + throttled pulses keep
  network cost near current. **TL to confirm** Append-Blob write volume and daily NDJSON size
  under realistic traffic.
- **Query cost:** `queryAggregated` currently reads every event in the range into memory. The
  tree roll-up is one extra pass — fine at current scale, but **TL to set a horizon** (when do
  we need pre-aggregated daily rollups instead of scanning raw?).
- **Threshold tuning** (§3.3) should be validated against a few real sessions before we trust
  the "engaged" classification.

---

## 8. Recommendation

1. **Client:** add a `DwellTracker` module in the renderer (subscribes to the store signals
   already exposed, plus visibility/idle), emitting `view.dwell`. ~1 self-contained file.
2. **Server:** add `queryEngagement` (tree roll-up over `view.dwell`) + `GET
   /api/analytics/engagement` following the `add-rest-endpoint` pattern.
3. **UX:** ship the **Admin Engagement dashboard** (§5.1) first; **Your Activity** (§5.2) as a
   fast follow; **hold** the tree heat overlay (§5.3).
4. Instrument the leaf, roll up by ID; report **visits and engaged time as two separate
   numbers**; **cap every visit** so a heuristic misfire can never distort the totals.

Suggested decomposition (create after owner/TL sign-off): (a) DwellTracker + `view.dwell`
event + config thresholds; (b) `queryEngagement` + endpoint; (c) Admin Engagement dashboard;
(d) Your Activity view. (a)+(b) are prerequisites for (c)/(d).

---

## Appendix A — event taxonomy summary

| Event | When | Metric | Notes |
|---|---|---|---|
| `session.start` / `session.end` | init / unload | — | breadcrumb (exists) |
| `tab.switch` | activeTab change | — | breadcrumb (exists) |
| `node.select` | selectedNodeId change | — | breadcrumb (exists); redundant as metric once dwell lands |
| **`view.dwell`** | **visit close** | **engaged_ms + visit** | **new — the metric-bearing event** |

## Appendix B — worked hierarchy example

User opens Skeptic tab, reads `skp-bel-002` for 7 min (active), glances at `skp-bel-005`
for 3 s, switches to Debate for 12 min:

```
view.dwell subject=skp        tab-level, engaged≈(pre-node)
view.dwell subject=skp-bel-002 engaged_ms=420000 engaged=true  close=subject_change
view.dwell subject=skp-bel-005 engaged_ms=3000   engaged=false close=subject_change
view.dwell subject=debate      engaged_ms=720000 engaged=true  close=unload
```

Roll-up (aggregate): tool 19.05 min · taxonomy 7.05 min · camp skp 7.05 min ·
category skp-bel 7.05 min (2 visits, 1 engaged) · debate 12 min. The 3-second glance shows as
a **visit** but not **engaged time** — exactly the distinction requested.
