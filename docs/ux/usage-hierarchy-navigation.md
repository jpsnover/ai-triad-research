# Usage Hierarchy Navigation: Drill-down, Tree & Scope Filtering

**Status:** Spec ready for review (owner + Tech Lead) before decomposition
**Owner:** Design
**Implementer:** Taxonomy Editor
**Builds on:** `usage-analytics-instrumentation.md` (t/2463, which defines the `view.dwell` event and the `GET /api/analytics/engagement` roll-up) · **supersedes** the flat "Feature Usage" grouping in `analytics-dashboard.md` §3 and unifies its report views 2–4 (camp distribution / category drill / top nodes) into one navigable surface
**Interactive mockup:** https://claude.ai/code/artifact/bf653815-7c45-4025-8770-13a867d0e4d1

---

## 0. TL;DR

Engagement data is a **hierarchy**. Usage rolls up `Total → Tool → … → leaf`, and the reporting
UX must let an admin **see the aggregate for any subtree, or drill to a particular one**, and
**scope the whole view to one user or one session**. This spec defines that navigation as three
reusable, structure-agnostic components plus a leaf cross-axis panel. It does not change the
instrumentation; it defines how the rolled-up tree is presented and filtered.

The design rests on two ideas:

1. **The WHAT axis is a forest, not a tree.** Each tool has its own natural shape. One set of
   components renders all of them because they only ever need *"a level's children, each with its
   rolled-up total."* Tool-specific vocabulary lives in a single **KIND registry** (§4), nowhere
   else in the UI code.
2. **WHO is an orthogonal scope, not a separate screen.** User and session are a filter that
   recomputes *every* number in the hierarchy. WHAT (drill position) and WHO (scope) are
   independent; every figure shown is their **intersection**.

---

## 1. The two axes

| Axis | Question | Control | Model |
|---|---|---|---|
| **WHAT** | Which content/tool draws engagement? | Breadcrumb drill-down + tree | A forest: `Total → Tool → …tool-specific… → leaf` |
| **WHO** | Whose engagement? | Scope pills (user → session) | A filter applied to the whole WHAT axis |

You keep your WHAT position while changing WHO, and vice-versa. At a **leaf** the two axes
cross-link (§6): pick a user *from* a node's breakdown, or see a scoped user's node *by session*.

### 1.1 The WHAT forest

```
Total
├─ Taxonomy   ─ Camp ─ Category ─ Node            (4 levels; POV camps acc/saf/skp/cc)
├─ Chat       ─ Conversation                       (2 levels; flat list)
├─ Intellectual Lineage ─ Chain ─ Source           (3 levels; sources ref taxonomy nodes)
├─ Situations ─ Situation ─ Perspective            (3 levels; per-camp view)
├─ Debate Engine                                   (leaf; no sub-structure yet)
└─ Summaries                                        (leaf)
```

Heterogeneous depth is expected and fine. The taxonomy tier structure comes straight from the
instrumentation's node-ID parse (`{pov}-{cat}-{NNN}`, §2.1 of the instrumentation spec). The
other tools roll up under `tool → …` with their own leaf grain (a conversation id, a source id,
a perspective id). New tools appear automatically once they emit `view.dwell` with a
`subject_id` and a registered KIND.

---

## 2. Components

### 2.1 Scope bar (WHO): persistent, above the breadcrumb

```
Scope   [ 👥 Everyone ▾ ]                         3 users · 12 sessions
        └ pick a user ┘
Scope   [ 👤 jsnover13@gmail.com ✕ ] › [ 🕒 All sessions ▾ ]   2 sessions · 41 nodes
Scope   [ 👤 jsnover13@gmail.com ✕ ] › [ 🕒 Yesterday 19:40 ✕ ]   1 session · 9 nodes
```

- **User pill** opens a **searchable** picker (the "Filter by user…" affordance from the current
  dashboard, now driving the whole page). Each user row shows their engaged time + session count.
- Choosing a user reveals the **session pill** (that user's sessions, by time, each with engaged
  time + node count). Session is only meaningful under a user, so it never appears standalone.
- Each pill carries an **✕** to clear that level; clearing the user clears the session too.
- **Persistent by design.** In an admin tool a hidden filter that silently changes every number
  is a support-ticket generator. The pills stay visible and double as a breadcrumb for the WHO
  axis. A right-aligned hint line restates the active scope in words.

### 2.2 Drill-down (WHAT, default view)

```
Total › Taxonomy › Accelerationist › Beliefs                    ← breadcrumb, every segment clickable

  ENGAGED        VISITS      NODES       USERS                   ← summary card = the AGGREGATE
  1h 30m         318         12          6                          for the current subtree, in scope

  12 nodes with activity in Beliefs, by engaged time
  ───────────────────────────────────────────────────────────
  acc-bel-003  Compute scaling is primary   1h 05m   142   40% ███▍ ›
  acc-bel-001  Open weights accelerate…        58m    71   23% ██   ›
  …
```

- **Summary card** = rolled-up aggregate for the current subtree *within the active scope*.
  Metrics: **Engaged** (primary, capped engaged-ms → `1h 30m`), **Visits**, a **count** metric
  whose label comes from the leaf kind (Nodes / Conversations / Sources / Perspectives / Items
  for a mixed root), and **Users** (hidden once scoped to a single session).
- **Breakdown table** = immediate children only, each row itself the rolled-up aggregate of *its*
  subtree, sorted by engaged time, with a **share-of-parent** bar (design-system `--bar` blue).
- **Row click descends** one level; the breadcrumb grows. Every non-summary column uses
  `tabular-nums`. Rows are keyboard-focusable (`Enter`/`Space` to descend).
- **Column header, kind tag, breakdown noun, and count-metric label all rename themselves** from
  the KIND registry (§4). No per-tool branching lives in the component.

### 2.3 Tree (WHAT, toggle): cross-level comparison

Indented expand/collapse grid for holding several branches open at once. Same aggregates; bars
are **share-of-scoped-total**. Use when comparing across levels rather than navigating. It is a
**view toggle on the same panel** (top-right, next to the date range), not a separate page.
Drill-down stays the default. Under an active scope, branches that roll up to zero are hidden.

### 2.4 Leaf cross-axis panel (§6): where WHO meets WHAT

At a leaf the breakdown table is replaced by a WHO breakdown of that single subject (see §6).

---

## 3. Interaction rules

1. **Scope recomputes everything.** Changing user or session re-renders the summary card,
   breakdown bars, tree, and leaf panel. Nothing on screen is left un-scoped.
2. **Axes are independent.** A scope change preserves the drill path; a drill change preserves the
   scope. If a scope makes the current subtree empty, show the empty state (§5). Do **not**
   auto-navigate away; the branch still exists structurally.
3. **Everything with children is a branch; everything without is a leaf.** Every row is clickable.
   A leaf click makes it the current subject and shows its cross-axis panel (§6), including
   sub-structure-less tools like Debate Engine ("who used the debate engine").
4. **Breadcrumb is the up-navigation** for WHAT; scope pills are the up-navigation for WHO.

---

## 4. The KIND registry: the only place tool vocabulary lives

A single map keyed by node kind supplies every human label. Adding a tool = adding a row (and
emitting `view.dwell` for it); no component changes.

| kind | tag label | column header (as a child) | count-metric unit | shows an ID chip |
|---|---|---|---|---|
| `root` | All usage | Section | Items | — |
| `section` | App section | *(derived from child)* | — | — |
| `camp` | POV camp | Camp | — | — |
| `category` | BDI category | Category | — | — |
| `node` | Taxonomy node | Node | Nodes | yes (`acc-bel-003`) |
| `conversation` | Chat conversation | Conversation | Conversations | — |
| `chain` | Lineage chain | Lineage chain | — | — |
| `source` | Lineage source | Source | Sources | yes (`src-…`) |
| `situation` | Situation | Situation | — | — |
| `perspective` | Camp perspective | Perspective | Perspectives | — |

The **child-column header is derived from the actual child kind**, not the parent. That is what
lets one `section` (Taxonomy) show "Camp" while another (Chat) shows "Conversation" with no
special-casing.

---

## 5. States

- **Empty (no data at all):** "No analytics data available. Engagement will appear as users
  interact with the app." (matches the existing dashboard empty state).
- **Empty under scope:** "No activity in this branch for the selected user / session." The
  branch is valid; the *scope* is empty. Never blank the page.
- **Loading:** skeleton rows in the breakdown/tree and skeleton numbers in the summary card while
  the scoped query resolves.
- **Single leaf under a session:** the leaf panel collapses to a one-line statement (§6).

---

## 6. Leaf cross-axis: the two axes crossing

Landing on a leaf (a node, conversation, source, perspective, or a leaf tool) replaces the
breakdown with a WHO breakdown of *that subject*, honoring current scope:

- **No user scoped →** *"Who engaged with this {kind}? Click a user to scope the whole view to
  them."* Rows = users on this subject (engaged + visits), **each click sets the user scope while
  keeping the drill position.** (WHAT-first: find a hot node, then see who.)
- **User scoped →** *"{user} on this {kind}, by session. Click one to narrow further."* Rows =
  that user's sessions on this subject; click sets the session scope. (WHO-first: pick a user,
  then see what/when.)
- **Session scoped →** one line: *"In session {when}, {user} spent {engaged} on this {kind}."*

So a reviewer can travel WHAT→WHO or WHO→WHAT over the same data, in either direction.

---

## 7. Data contract (what the presentation needs from the endpoint)

The instrumentation spec already defines `GET /api/analytics/engagement` returning
`{ aggregate: <TreeNode>, subtree, daily, users }` where each `TreeNode` carries
`{ visits, engagedVisits, engagedMs, uniqueUsers, cappedRate }` and children. This UX consumes
that tree directly. **Three additions are required (flag for Tech Lead)** (all are query-time
filters over the same single pass, no new storage):

1. **`?session=<sid>` filter** (alongside the existing `?user=`). Scoping to a session must return
   the whole `aggregate` TreeNode recomputed for that session. The client must *not* hold the raw
   event log to do this itself.
2. **A `sessions` list per user** (id + start time + engagedMs + node count) so the session picker
   and the leaf "by session" breakdown can render without a second round-trip. Mirror the shape of
   the existing `users` array.
3. **Subject-scoped WHO breakdown** for the leaf panel:
   `GET /api/analytics/engagement?subject=<id>&groupBy=user|session` → rows of
   `{ user|session, engagedMs, visits }`. This powers §6.

Roll-up for non-taxonomy tools uses the same "instrument the leaf, roll up by id" rule, with a
`subject_id` of `chat-01`, `src-l02`, `sit-01b`, etc., and a `subject_type` already carried in
`detail`. Per-user raw stays **admin-gated** exactly as `/query` and the engagement endpoint
already are.

---

## 8. Accessibility & responsive

- **Keyboard:** breakdown/tree rows are focusable; `Enter`/`Space` descends/expands. Scope pills
  and menu items are real `<button>`s; menus close on `Esc` and outside-click; focus returns to
  the triggering pill on close. Visible focus ring on every interactive element (`--focus`).
- **Contrast / theme:** all four themes (light, dark, bkc, harvard) via design-system tokens; share
  bars use `--bar`, semantic states are separate from the accent. `prefers-reduced-motion`
  disables the disclosure/scroll animations.
- **Numerals:** `font-variant-numeric: tabular-nums` on every figure column.
- **Responsive:** share-bar column drops below ~580px (percentages remain as text); summary metrics
  wrap; scope hint hides on narrow. Wide tables scroll inside their own `overflow-x:auto` container.

---

## 9. Placement & file changes

**Placement:** a **"By Taxonomy" / "By Tool" view within the existing `/analytics` route**
(admin-gated, web-only, per `analytics-dashboard.md`), sitting alongside the per-user table and
time series rather than replacing them. Recommended as a **tab within the analytics page** so both the
flat headline view and the hierarchical view coexist. Reuses the existing date-range picker and
admin gating.

| File | Change |
|---|---|
| `taxonomy-editor/src/renderer/components/analytics/UsageHierarchy.tsx` | New — scope bar + drill-down + tree + leaf panel |
| `taxonomy-editor/src/renderer/components/analytics/kindRegistry.ts` | New — the KIND map (§4) |
| `taxonomy-editor/src/renderer/components/AnalyticsDashboard.tsx` | Add the hierarchy tab; keep existing sections |
| `taxonomy-editor/src/renderer/hooks/useAnalytics.ts` | Extend for `?session=` scope + subject WHO breakdown |
| `taxonomy-editor/src/server/community/analytics.ts` · `routes/session.ts` | (TL scope) `session` filter, `sessions` list, `subject`+`groupBy` — §7 |

---

## 10. Open decisions (for owner / TL)

1. **By-node pivot (deferred).** Because Lineage sources and Situation perspectives *reference*
   taxonomy nodes, a second slicing is possible from the same event log by grouping on node
   instead of tool, giving *"all engagement touching `acc-bel-003`, across every tool."* It answers
   *"which ideas draw attention regardless of surface,"* arguably the core research question. It is a
   **pivot, not a new hierarchy**, but a real scope increase. Held pending a decision.
2. **Tab vs. primary view.** Ship as a tab beside the current dashboard sections (recommended), or
   promote the hierarchy to the primary analytics view with per-user as a leaf drill-down.
3. **Research-integrity guard.** Per the instrumentation spec §5.3 / §6, this stays admin-only and
   observational, never surfaced into a participant-facing analysis session.
