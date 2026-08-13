# Op-Ed Studio — GUI for `New-OpEd`

**Ticket:** (unfiled — this spec)
**Author:** Design (Orca)
**Status:** Spec — ready for TL feasibility + Server scoping (new content type + IPC required)
**Mirrors:** the Debate tool — `taxonomy-editor/src/renderer/components/debate/DebateTab.tsx` (My/Community tabs, full-width table, create dialog, share/copy), `NewDebateDialog.tsx` (two-screen create flow), `useCommunityStore`
**Backs:** the `New-OpEd` cmdlet — `scripts/AITriad/Public/New-OpEd.ps1`

---

## 1. Goal

Add an **Op-Ed Studio** to the app: a first-class left-toolbar tool, directly **below Chat**, that lets a user **browse** and **create** op-eds (guest essays written in a single AI Triad camp voice, grounded in the project taxonomy). It mirrors the Debate tool's information architecture exactly — a **My / Community** split, a full-width list, a guided create dialog, and per-item Open / Export / Share (My) or Copy (Community) — so the tool feels native to anyone who has used Debate.

`New-OpEd` already produces publication-ready essays with taxonomy grounding. Today it is CLI-only and writes to a file. This spec gives it a home in the GUI: a **library** of saved op-eds and a **create flow** that maps the cmdlet's parameters onto a two-screen dialog.

### What an op-ed is (design-relevant differences from a debate)

| | Debate | Op-Ed |
|---|---|---|
| Voices | 1–3 camps + optional user | **One or more** camps — a shared topic produces **one op-ed per selected voice** (multi-voice sets shown in tabs) |
| Output | multi-turn transcript + argument network | a single **essay**: headline, subtitle, body (Markdown), optional pitch email |
| Source | topic / doc / url / cross-cutting | **topic** *or* **url** |
| Grounding | greatest-hits nodes | POV BDI nodes + situations, each with a **Reflection** ("how/where it's used") |
| Reading | interactive, needs a window | **read like an article** — the detail pane can render it inline |

These differences shape two places where Op-Ed Studio intentionally diverges from Debate: the **create dialog** (single-camp picker, outlet/word-count, news-hook/thesis/bio fields) and the **detail pane** (renders the essay as an article, with a grounding table).

---

## 2. Toolbar placement

`taxonomy-editor/src/renderer/data/navConfig.ts` — add one **primary-tier** item immediately after `chat`:

```ts
{ id: 'opeds', label: 'Op-Eds', icon: Newspaper, tier: 'primary', action: { type: 'custom', id: 'opeds' } },
```

- **Order:** `search · taxonomy · debate · chat · opeds` — Op-Eds sits at the bottom of the primary group, directly below Chat (the user's explicit requirement).
- **Icon:** `Newspaper` (lucide) — reads as "opinion / press," distinct from `MessageSquare` (Debate) and `MessageCircle` (Chat). Alternative if a more "authoring" read is wanted: `PenLine`. Recommend `Newspaper`.
- **Label:** `Op-Eds` (hyphenated, matches the cmdlet's `-Ed` and house style in `New-OpEd`).
- **Action:** `custom` id `opeds`, wired in `App.tsx`'s custom-action switch the same way `chat` / `taxonomy` are, so it swaps the main content region to `<OpEdTab />`. (It is a full workspace, not a `togglePanel` side panel.)
- **Gate:** ship behind a feature flag `env-electron-opeds` (mirrors `env-electron-summaries`) until the backend lands, so the nav item can merge dark.

---

## 3. Screen architecture

Reuse Debate's `two-column` → **table-mode** shell (`DebateTab` sets `isTableMode` when no side panel is active and not phone). Op-Ed Studio is a **full-width library** that you `Open` / select into a detail view.

```
┌────────────────────────────────────────────────────────────────────┐
│  Op-Eds                                    [ Edit ]  [ + New Op-Ed ] │  ← header
│  ┌──────────┬──────────────┐                                        │
│  │ My (12)  │ Community (30)│                                        │  ← list-view-tabs (reuse .list-view-tabs)
│  └──────────┴──────────────┘                                        │
│  [ Search op-eds…                                                 ]  │  ← search box
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Headline           │ Camp │ Outlet │ Words │ Date  │ Actions  │  │  ← full-width table
│  │ Mandatory audits…  │ SAF  │ WaPo   │  812  │ Aug 8 │ Open ⋯   │  │
│  │ Open-weight models │ SKP  │ —      │  790  │ Aug 7 │ Open ⋯   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

Selecting a row (or `Open`) shows the **essay reader** (Section 6). On desktop this is a right detail pane (master–detail, like Debate's non-table inline summary); on phone it pushes a full-screen reader via `useMobileNav`. Unlike Debate — whose "Open" launches a separate popout window because a live debate needs its own process — an op-ed is static text, so **inline read is the default** and no popout window is required. (An "Open in window" affordance is optional, not v1.)

Component tree (new files, all under `components/opeds/`):

```
OpEdTab.tsx              — shell: header, My/Community tabs, search, table ⇄ reader
  OpEdListPanel          — header actions + tab toggle (mirror DebateListPanel)
  OpEdTable.tsx          — full-width <table>, variant="my|community" (mirror DebateTable)
  OpEdReader.tsx         — renders one essay as an article + grounding table
  NewOpEdDialog.tsx      — two-screen create flow (mirror NewDebateDialog)
  OpEdTab.css / OpEdTable.css / NewOpEdDialog.css
hooks/useOpEdStore.ts    — personal op-eds (mirror useDebateStore)
  (community op-eds reuse an extended useCommunityStore — see §8)
```

---

## 4. The list table

Full-width semantic `<table>` (`<thead>` / `<th scope="col">` / `<caption class="sr-only">Op-Eds</caption>`), same construction and a11y contract as `debate-list-tables.md`.

| Column | Source (My) | Source (Community) | Align | Wrap |
|---|---|---|---|---|
| **Headline** | `o.headline` (fallback: title) | `co.headline` | left | **wraps** 2–3 lines then ellipsis; full text in `title=`. Secondary line: subtitle (muted, 1 line). |
| **Camp** | `o.pov` | `co.pov` | left | camp chip — colored dot + short label (ACC/SAF/SKP), using `POVER_INFO[pov].color`. nowrap |
| **Outlet** | `o.outlet` (or `—`) | `co.outlet` (or `—`) | left | nowrap, ellipsis |
| **Words** | `o.word_count` | `co.word_count` | right (numeric) | nowrap |
| **Date** | `formatDate(o.updated_at)` | `formatDate(co.updated_at)` | left | nowrap |
| **Actions** | Open · Export · Share | Open · Export · Copy | right | nowrap |

- **Camp chip** is the op-ed's single-voice identity — reuse `CampGlyph` + `POVER_INFO` colors (the same accent used in `NewDebateDialog`'s debater chips). This is the one column op-eds add that debates' table doesn't have, and it earns its place: the camp voice *is* the essay's defining attribute.
- **Headline** takes the flexible column (`width:auto`); everything else sizes to content — so a long headline wraps rather than widening the table (same rule as the debate Title column).
- **Grounded badge (optional, My only):** a small `● grounded` / `voice-only` tag in the Headline secondary line, from whether `grounding.length > 0`. Low priority; implementer's discretion.

**Actions (icon+label; icon-only with `aria-label`+tooltip on narrow widths; `stopPropagation`):**

- **My:** `Open` (select → reader, primary emphasis) · `Export` (Markdown / PDF / text — reuses the essay's Markdown; see §7) · `Share` (submit to community, mirror `submitToCommunity('oped', …)`).
- **Community:** `Open` · `Export` · **`Copy`** (`copyItem('opeds', id)` → `loadOpEds()`; hidden for anonymous users, per `!auth?.anonymous` — same rule as Debate). Do **not** render a disabled Share on community rows.

**Preserve** (identical semantics to Debate): search box filters rows; **Edit mode** (My) gives a leading checkbox column for bulk-delete + inline Headline rename — which edits the **set-level `topic`** (the label rendered in the Headline column), **never** the AI-generated per-voice essay headlines (each voice's own reader `<h1>`; N per set); no schema change, mirrors Debate's session-title rename (t/2592); active/selected row highlighted by a left accent bar + `aria-current` (not color alone); empty/loading states as full-width rows spanning all columns; column sort (`aria-sort`) on Headline/Camp/Outlet/Words/Date, default Date-desc.

**Empty states:**
- **My, none yet:** "No op-eds yet. Create one to draft a guest essay in a camp voice." + `[ + New Op-Ed ]`.
- **Community in Electron:** reuse Debate's notice — "Community op-eds are only available in the web app."

---

## 5. Create flow — `NewOpEdDialog`

Two screens, mirroring `NewDebateDialog`'s **Screen A (quick) + Screen B (settings drawer)** pattern, so the common path is one short form and the full parameter surface is one click away. Every field maps to a `New-OpEd` parameter.

**Platform (v1) — create is Electron-only (PI-confirmed, TL ruling on the epic, t/2570#3).** `New-OpEd` is a PowerShell cmdlet the web server can't run, so **the whole create flow below is a desktop-only mount.** In the **web** app the `+ New Op-Ed` control renders **disabled** (not hidden — discoverability) with the affordance *"Available in the desktop app"*; browse / share / copy stay platform-agnostic. Include the disabled web state in Design's four-theme review scope. No web-side generation in v1.

### Screen A — the essential form (≈560 px, single column)

```
┌──────────────────────────── New op-ed ──────────────────────────× ┐
│                                                                     │
│  Topic *                                                            │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ e.g. Mandatory pre-deployment audits for frontier AI models   │ │  ← -Topic (auto-grow textarea)
│  └───────────────────────────────────────────────────────────────┘ │
│  ⌥ From a web page instead →  [ paste URL ]                         │  ← toggles to -Url (mutually exclusive, like NDD source picker)
│                                                                     │
│  Voices — one op-ed each *                                          │
│  [ ☐ Accelerationist ][ ☑ Safetyist ][ ☐ Skeptic ]                  │  ← -Pov (MULTI-select, one call per voice)
│  Will create 1 op-ed — Safetyist.                                   │  ← live count; relabels submit → "Draft N op-eds"
│                                                                     │
│  Outlet                                                             │
│  [ Generic ▾ ]   → sets a target length (~800 words)               │  ← -Outlet (select; hint shows the band's word count)
│                                                                     │
│  News hook  (strongly recommended)                                 │
│  [ e.g. the Senate AI oversight bill up for a floor vote next week]│  ← -NewsHook
│                                                                     │
│  ▸ More options (thesis, author bio, word count, grounding, model) │  ← opens Screen B
│                                                                     │
│  [ Pitch email too ]                                     ⚙         │  ← -IncludePitch toggle
│                                            [ Cancel ] [ Draft op-ed ]│
└─────────────────────────────────────────────────────────────────── ┘
```

Screen-A fields:

1. **Topic** (`-Topic`) — auto-grow textarea, required in the default path. A **"From a web page"** toggle swaps it for a URL input (`-Url`) exactly like `NewDebateDialog`'s topic/source mutual exclusion; when a URL is given, Topic becomes an optional "angle" hint. **Anonymous users:** URL sources are blocked (reuse the Debate rule — "Sign in to use URL sources").
2. **Voices** (`-Pov`, one call per voice) — a **multi-select** group of three camp chips (ACC / SAF / SKP), colored via `POVER_INFO`. **At least one required; each selected voice produces its own op-ed on the shared topic.** A live count line reflects the choice: *"Will create 1 op-ed — Safetyist."* / *"Will create 2 op-eds on the same topic — Skeptic, Safetyist — shown in tabs."* and the submit button relabels (`Draft op-ed` → `Draft 2 op-eds`). This is the op-ed's defining choice, so it's on Screen A. **Implementation:** the GUI issues one `New-OpEd` call per selected camp with identical topic/outlet/hook/settings, differing only in `-Pov` (parallel where the backend allows). One shared topic in, N single-voice essays out — see §6.1.
3. **Outlet** (`-Outlet`) — select of the eight real outlets (WashingtonPost, NYTimes, WallStreetJournal, USAToday, ForeignAffairs, Politico, Regional, Generic). Selecting one shows its target word band as a hint (e.g. "The Washington Post — ~800 words, strong news hook"). Default **Generic**.
4. **News hook** (`-NewsHook`) — single-line input, labeled *strongly recommended* (the cmdlet's own guidance: op-eds without a hook get rejected). If left blank, show an inline note that the model will invent a plausible hook to verify before submitting.
5. **Pitch email** (`-IncludePitch`) — a checkbox in the footer row.
6. **More options** → Screen B.

`Draft op-ed` is enabled when: a topic **or** URL is present, a camp is selected, and the active model has a key (reuse `NewDebateDialog`'s `canStart` / key-check + free-tier pinned-model logic verbatim). On submit → §5.2 generating state.

### Screen B — "More options" drawer (mirrors `DebateSettingsDialog`)

Left-nav + body drawer, same chrome as Debate's settings. Sections:

| Section | Fields → cmdlet param |
|---|---|
| **Length & outlet** | Outlet (dup of A) · **Word count** override slider/number 300–2000 (`-WordCount`, overrides the outlet band) |
| **Angle** | **Thesis** (`-Thesis`, textarea — "leave blank to let the camp's values derive one") · **Author bio** (`-AuthorBio`, input — "credentials for the byline") |
| **Grounding** | **Ground in taxonomy** master toggle (on = default; off = `-VoiceOnly`) · **Max BDI nodes** 0–40 (`-MaxGroundingNodes`, default 12) · **Max situations** 0–15 (`-MaxSituations`, default 3). Show a one-line explainer: "Grounding injects this camp's most relevant registered beliefs/desires/intentions and situation stress-cases as the positions the essay must argue from." |
| **Model** | **Model** select (`-Model`, default `gemini-3.6-flash`; "step up to `gemini-3.1-pro-preview` for maximum polish") · **Temperature** 0–2 (`-Temperature`, default 0.8). Reuse Debate's model-family/refresh pattern + free-tier pinning. |

Screen B carries a "modified" dot per section (reuse `sectionHasDiff`), `Reset to defaults`, and `Apply`. Defaults exactly match the cmdlet's parameter defaults so the untouched path == `New-OpEd -Topic … -Pov …`.

### 5.2 Generating state (long-running)

`New-OpEd` is **not instant** — it does retrieval, a long-form generation call, and a second **reflection pass** over the finished essay. Design for **30 s – 2 min**:

- On `Draft`, the dialog shows a **progress panel** (not a spinner-only): stepwise labels reflecting the cmdlet's real stages, **one write step per selected voice** —
  1. *Retrieving grounding* (skipped if voice-only) → 2. *Writing the {camp} op-ed* (repeated per voice — e.g. "Writing the Skeptic op-ed", "Writing the Safetyist op-ed") → 3. *Mapping grounding across N drafts* (the reflection pass) → 4. *Done*. For a single voice the panel reads "Drafting your op-ed…"; for a set, "Drafting N op-eds…".
- Disable inputs; allow **Cancel** (abort all in-flight requests).
- On success, close the dialog and **open the result in the reader** — a single op-ed opens directly; **a multi-voice set opens with a camp-tab strip** (§6.1) on the first voice.
- **Graceful degradation** (surface the cmdlet's own fallbacks, don't hide them): if grounding retrieval fails, the essay still writes voice-only — show a **non-blocking notice** in the reader ("Taxonomy grounding was unavailable — written from voice alone"). If the model returns non-JSON, the body still renders (raw text) — no error wall.
- **Errors** use the `ActionableError` shape already returned by the cmdlet (Goal / Problem / Location / Next Steps) — render Next Steps as a short list, never a bare stack.

---

## 6. The essay reader — `OpEdReader`

Where an op-ed most diverges from a debate: it should **read like the article it is**, not a metadata dump.

### 6.1 Multi-voice sets — camp tabs

When a create run produces **more than one** op-ed (multiple voices on one topic), the reader shows a **camp-tab strip** directly under the action bar — one tab per voice, each carrying that camp's color + full label (Accelerationist / Safetyist / Skeptic). Selecting a tab swaps the article below it; the active tab's underline uses that camp's color (`--color-acc/saf/skp`), so the reader always signals *which voice you're reading*. A single-voice result renders **no tab strip** (one article, full-bleed). Accessibility: `role="tablist"` / `role="tab"` / `aria-selected`, arrow-key roving between tabs, each panel an `<article>`.

**Persistence — a multi-voice run is a grouped set (user decision).** The N op-eds from one create run persist as a **single grouped library entry** ("op-ed set"), not N loose rows. In the **My** table the set is one row: the **Camp cell shows all N camp chips**, the Headline carries a **`▸ N voices`** tag, and the row **always opens tabbed** (every visit, not just right after creation). This makes a multi-voice comparison a durable object the user can return to. Row-level Export/Share act on the **whole set** (e.g. export all voices to one Markdown file with per-voice sections; share the set). Individual-voice actions live inside the reader (per-tab). A single-voice op-ed remains an ordinary one-row entry. This requires a real **set/grouping concept in the op-ed store and community type** — see Dependency #7. (v2 could add a side-by-side "compare two voices" view; v1 is tabs.)

```
‹ Op-Eds                                         [ Export ▾ ] [ Share ]
┌──────────────┬──────────────┬─────────────┐
│ ■ Skeptic    │ ■ Safetyist  │             │   ← camp tabs (only when >1 voice)
└──────────────┴──────────────┴─────────────┘
   ██ SKEPTIC · Unsubmitted · 655 words
   # We're About to Mandate an Audit We Don't Know How to Perform
   …essay body for the selected voice…
```


```
┌───────────────────────────────────────────────────────────── ┐
│  ‹ Op-Eds                                    [ Export ▾ ] [Share]│  ← back (phone) + actions
│                                                                 │
│  ██ SAFETYIST · The Washington Post · 812 words                 │  ← camp-accent strip (POVER color)
│                                                                 │
│  # Mandatory Pre-Deployment Audits Are the Floor, Not the       │  ← headline (article H1)
│    Ceiling                                                      │
│  *Why the Senate's oversight bill must go further*              │  ← subtitle (muted italic)
│                                                                 │
│  ┌── essay body (rendered Markdown, readable measure ~68ch) ──┐ │  ← -Body
│  │ Lorem ipsum … the lede opens on the news hook …            │ │
│  │ …                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ▸ Pitch cover email                                            │  ← -Pitch (collapsible; only if present)
│                                                                 │
│  ▾ Taxonomy grounding (7 elements)                              │  ← -Grounding table (collapsible)
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Element              │ Type │ Rel.  │ Reflected in the op-ed│  │
│  │ saf-belief-014 …     │ BDI  │ 0.82  │ "Grounds the claim…"  │  │
│  │ sit-… stress case    │ Sit  │ 0.77  │ "(not reported)"      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────── ┘
```

- **Article typography:** headline uses the app's display scale; body renders Markdown at a **comfortable reading measure** (~64–72ch, centered column) — this is a reading surface, so it may run narrower than the full pane. Respect the design system's type tokens (`design-system.md`); do not hand-roll sizes.
- **Camp accent strip** carries `POVER_INFO[pov].color` (the essay's single voice) — the reader's one strong color cue, mirroring Debate's per-POV bars. Indicated by label text too, never color alone.
- **Pitch** (`-Pitch`) — collapsible, only rendered when `IncludePitch` produced one. Copy-to-clipboard button (it's meant to be pasted into an email).
- **Grounding table** (`-Grounding`) — the same columns the cmdlet writes to its Markdown export: **Element (id) · Type (BDI/Situation) · Relevance · Reflected in the op-ed** (the model's Reflection, or "(not reported)"). Collapsed by default under the essay; this is the "receipts" for academics — clarity/density over flourish, per the role's audience note.
  - **Each element id is clickable → inline expand.** Clicking an element id opens a **detail card directly below the table** (not a navigation away) showing that taxonomy element: its **label, category** (Belief/Desire/Intention/Situation), **POV/camp, relevance score, the element's own statement/description**, and **how it's reflected in this op-ed** (the Reflection line). The clicked row is highlighted (`aria-expanded`, active-row tint); clicking again (or the card's ✕) collapses it; only one open at a time. A secondary **"Open in Taxonomy →"** control in the card jumps to the full node for readers who want the complete record. This mirrors the app's existing inline-preview pattern (`SearchPreview` / `LineageDetailView` in the right pane) rather than inventing a new one — the reader stays in place while inspecting the evidence. Reuse the shared taxonomy ref-detail renderer; do not fork it.
  - **Accessibility:** each id is a real `<button aria-expanded>`; the detail card is keyboard-reachable and dismissible with Escape; the expand does not steal scroll focus (`scrollIntoView({block:'nearest'})`, honoring `prefers-reduced-motion`).
- **Actions:** Export (§7) and Share (My only; Copy on Community). Metadata (model, backend, created/updated, grounded-vs-voice-only) lives in a small **"Details"** disclosure, not competing with the essay.

---

## 7. Export

Reuse Debate's export pattern (`ExportOptionsDialog` + `api.exportDebateToFile` shape). An op-ed's canonical form is already Markdown, and `New-OpEd -OutputPath` already defines the file layout (`# headline`, `*subtitle*`, body, `---`, pitch, `---`, grounding table). So:

- **Formats:** Markdown (the native form — reuse the cmdlet's exact layout), PDF (rendered article), Plain text.
- **Options dialog:** a single checkbox — **Include taxonomy grounding table** (default on). (Debate's two-option dialog collapses to one here.)
- No new formatter design needed beyond wiring; the Markdown assembly already exists in `New-OpEd.ps1` and should be the single source of truth (server/bridge reuses it rather than re-implementing in TS).

---

## 8. States, edge cases, accessibility

**States & edge cases**
- **No outlet / no word count** → `—` in the cell (never an empty cell).
- **Voice-only op-ed** → grounding table replaced by a one-line "Written from voice alone (no taxonomy grounding)." No empty table.
- **Non-JSON model response** → body renders raw; no grounding; a quiet "formatting fell back to plain text" note.
- **Very long headline** → wraps to clamp then ellipsis; `title=` holds full text.
- **URL fetch failure** (create) → surface the cmdlet's ActionableError Next Steps; offer "use topic text instead."
- **Community in Electron** → web-app-only empty state (as Debate).
- **Anonymous** → Copy hidden (Community); URL source blocked (create); Share still available on My.
- **Row click vs actions** → row click selects → reader; action buttons `stopPropagation`; double-click Headline → rename (edit mode; edits the set `topic`, not the per-voice essay `<h1>`s).

**Accessibility** (same contract as `debate-list-tables.md`, plus reader specifics)
- Real `<table>`, `<th scope="col">`, `sr-only` caption; sortable headers are `<button aria-sort>`.
- Every icon-only action has an `aria-label` (Open / Export / Share / Copy) + tooltip.
- Create dialog: focus-trapped, `role="dialog" aria-modal`, Escape closes, focus restored to trigger (reuse `useFocusTrap` from `NewDebateDialog`).
- Camp radio group: `role="radiogroup"`, arrow-key roving tabindex (reuse the preset-card keyboard pattern).
- Camp identity conveyed by **label text + dot**, not color alone (AA contrast per all four themes: light, dark, bkc, harvard).
- Reader body is a landmark `<article>`; headline is the sole `<h1>` of the region; grounding disclosure is a real `<button aria-expanded>`.
- Progress panel updates announced via `aria-live="polite"`; long generation never traps focus.
- Respect `(prefers-reduced-motion)` for the generating animation.

**Responsive** (mirror Debate)
- desktop/tablet-lg: all six columns; reader as right pane.
- tablet: collapse Outlet into the Headline secondary line; actions icon-only.
- phone: table degrades to stacked cards (Headline + camp chip, meta line, action row); reader is full-screen via `useMobileNav`; create dialog is full-screen.

---

## 9. Dependencies & cross-scope work (NOT design's to build — flag for TL/Server/PS)

This tool needs backend that does not exist yet. Enumerated so TL can scope and route; **Design owns only the spec + `/design-review-workflow` sign-off.**

1. **A personal op-ed store** (owner: Server / PS) — `New-OpEd` currently returns an object and optionally writes a file; there is **no "My op-eds" persisted store** analogous to debate sessions. Needs: save/list/load/delete/rename of personal op-eds (a `opeds/` user dir, `oped-<id>.json`), parallel to `saveDebateSession` / `listDebateSessionsMeta`.
2. **A bridge/IPC to invoke generation** (owner: Server + bridge) — a `api.createOpEd(params)` (Electron → PS `New-OpEd`, web → server route) that streams or reports the 3-stage progress, plus `loadOpEd` / `listOpEds`. The cmdlet already emits `Write-Verbose` per stage — surface those as progress events.
3. **Community content type `'oped'`** (owner: Server) — `community.ts` currently hardcodes `'chats' | 'debates'` across `submitToCommunity`, `copyFromCommunity`, `loadCommunityItem`, the listing index (new `communityOpedsDir()`, prefix `oped-`, `OPED_INDEX_VERSION`, a `CommunityOpedEntry` `toEntry` carrying headline/pov/outlet/word_count), and the admin removal path. This is a real, enumerable change — follow the `/add-rest-endpoint` playbook for the routes.
4. **`useCommunityStore` extension** (owner: Taxonomy Editor) — add `opeds` alongside `debates`/`chats` (fetch/list/copy), same shape.
5. **Nav wiring** (owner: Taxonomy Editor) — the `custom` action `opeds` in `App.tsx` + the `env-electron-opeds` flag.
6. **Reuse, don't re-implement** — export Markdown assembly lives in `New-OpEd.ps1`; the Reflection/grounding contract is the cmdlet's. TS surfaces should consume those, not fork them (parity risk — cf. entity name-normalization parity lessons).
7. **Op-ed "set" grouping** (owner: Server / PS + Taxonomy Editor) — a multi-voice run persists as **one grouped set** (§6.1), so the store needs a set concept: either a `set_id` shared across the N op-ed records (list/table groups by it) or a set wrapper object `{ set_id, topic, members: [opedId…] }`. Listing must return sets as single rows with their member camps; Export/Share/delete must operate at set granularity (and cascade to members); the community type must carry the same grouping. The generation IPC (#2) returns the member ids as a set. **This is the main net-new data-model piece beyond a straight per-item store — flag for TL to scope vs. the simpler "loose rows" alternative** (the user chose grouped sets).
8. **Clickable grounding → inline element detail** (owner: Taxonomy Editor) — the reader's grounding ids expand an inline taxonomy-element card (§6). Reuse the existing ref-detail/preview renderer (`SearchPreview` / `LineageDetailView` / the shared taxonomy ref component); needs a lookup from a grounding id to the node's label/category/description (already in the taxonomy store). No new backend if the node data is already client-side.

---

## 10. Open decisions (for the user / TL — I recommend, you decide)

1. **Live generation in-GUI vs. viewer-only for v1.** This spec designs **live create** (matches "create them" + the Debate precedent). If the IPC/backend (deps #1–#2) is too large for a first cut, a viable v1 is **library + reader only** (browse/share/copy op-eds generated via CLI), with create landing in v2. *Recommend: live create, but split the PR — ship library+reader first behind the flag, then create.*
2. **Icon:** `Newspaper` (recommended) vs `PenLine`.
3. **"Open in window"** — op-eds are static, so inline read is the default and a popout is optional. *Recommend: no popout in v1.*
4. **Grounded badge** in the table — nice-to-have. *Recommend: defer to v2.*

---

*After implementation, Design verifies via `/design-review-workflow` (all four themes, keyboard nav, headline wrap, multi-select voice group + live count a11y, multi-voice camp-tab keyboard nav, reader typography, grounding-table ref links) before marking Done.*
