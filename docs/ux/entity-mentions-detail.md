# Entity Mentions & Entity Detail View — UX Spec

**Last updated:** 2026-07-28
**Author:** Design (Orca)
**Status:** Draft — ready for review
**Tickets:** rendering/interaction consumer of the entity ontology (data half: t/1767, CL-owned, Done). This spec is the **UX/rendering half** — the `entity`/`term` detail renderers and inline-mention surfacing. It slots against the `t/1766` rendering track and the `DetailPane` container (t/1775). Confirm final ticket attachment with PM/TL before decomposition.

---

## 1. Problem

Entity extraction has landed the **data and the reference-resolution plumbing**, but nothing is user-visible yet:

- `DetailPane` renders `case 'entity'` and `case 'term'` as placeholders — *"Detailed entity view coming soon."*
- Inline linkification (`refLinkifyPlugin`) is filtered to `LINKABLE_KINDS = {node, situation, policy}`; `entity`/`organization`/`term` refs are detected by `scanRefs` but **not surfaced**.

So the extracted entities exist in `entities.json` and resolve through `GET /api/entity/:ref`, but a reader in the debate transcript, chat, POV items, or facts can neither *see* an entity mention nor *open* its details. This spec closes that gap.

---

## 2. What already exists (build against, do not fork)

The contract is landed; this spec fills the two renderer placeholders and the mention surface. Do not restate or re-implement the data model.

| Piece | Location | Role |
|---|---|---|
| `EntityRef` / `EntityDetail` / `Entity` types | `lib/entities/types.ts` | The discriminated-union contract. `Entity` record fields are fixed — render them, don't invent. |
| `resolveRef` | `renderer/components/shared/resolveRef.ts` | Resolves a ref → detail. `entity`/`org`/`term` hit `api.getEntity` (server); follows merge tombstones, stamps `redirected_from`. |
| `DetailPane` | `renderer/components/shared/DetailPane.tsx` | Right-hand container: header + body, `idle`/`loading`/`error`/`ready` states, `not_found`, exhaustiveness guard. **Mount point unchanged** — this spec only supplies the two missing `renderDetail` branches. |
| `scanRefs` | `lib/entities/scanRefs.ts` | Detects all six kinds as ID tokens in free text (non-overlapping, leftmost, validated). |
| `refLinkifyPlugin` | `renderer/components/shared/refLinkifyPlugin.ts` | Remark plugin; wraps hits in `<span class="ref-link" data-ref-kind="…">`. Kind filter is `LINKABLE_KINDS`. |
| `.ref-link` style | `debate-workspace/StatementCard.css` | Dotted-underline, `var(--accent)`, `<button>`, solid underline on hover/focus. |
| `OrganizationDetail` | `renderer/components/organizations/OrganizationDetail.tsx` | The read-mode pattern to mirror (badge, link rows, source chips). See `org-detail-redesign.md`. |

Container presentation is fixed by `DetailPane.css`: resizable right pane, `min-width: 280px`, `border-left`, header (title + close ✕), scrolling body. **The entity/term views render inside `.detail-pane-body` — they are body content, not a new container.**

---

## 3. Scope & phasing

"Inline entity mentions" has two layers with very different cost and data dependencies. Ship them in order.

### Phase 1 — Entity & term detail renderers + ID-token linkification *(no new data dependency; buildable now)*

1. **Entity detail view** — replace the `case 'entity'` placeholder (§5).
2. **Term detail view** — replace the `case 'term'` placeholder (§6).
3. **Widen ID-token linkification** — add `entity`, `organization`, `term` to `LINKABLE_KINDS` so literal ID tokens (`ent-042`, `org-openai`, `term:p-doom`) in prose become clickable (§4.1). This is a one-line filter change; the renderers above give it a destination.
4. **Entity browser** (§7) — a left-toolbar tool to display / search / sort entities, driving the shared DetailPane. This one carries a data dependency: the list/query endpoint (§7.4). It ships in Phase 1 if that endpoint lands with the DetailPane work, else Phase 1.5.

Items 1–3 are complete against landed data. Its real-world yield is modest — literal ID tokens are rare in natural prose — but it finishes the reference surface and makes every resolvable ref clickable everywhere `refLinkifyPlugin` runs.

### Phase 2 — Name / alias mention rendering *(depends on a CL data deliverable)*

Real entity mentions in prose are **names**, not ID tokens ("OpenAI", "the EU AI Act", not `ent-042`). Live name detection in the renderer (NER, alias matching, disambiguation) is out of scope and the wrong layer. Instead:

- The **mention→entity pipeline** (t/1767 plan item 4, CL-owned) precomputes mention annotations — `{ start, end, ref, confidence }` spans keyed to a specific source text — and stores them alongside the text.
- The renderer **consumes precomputed spans** and linkifies them (§4.2). No client-side NER.

Phase 2 needs the annotation format + emission from CL and a store/bridge path from TL. This spec defines the **rendering contract** for it so those can be built to a target; it does **not** assume Phase 2 data exists yet. **Data dependency — route to Comp-Linguist (annotation emission) and TL (storage/transport) before Phase 2 implementation.**

---

## 4. Inline mentions

### 4.1 ID-token references (Phase 1)

No visual change from today's node/situation/policy links — same `.ref-link` treatment, extended to the three new kinds by the filter flip. Display text stays the **raw source token, verbatim** (fidelity rule in `refLinkifyPlugin`).

- **Kind is not color-coded.** All ref-links keep the single `var(--accent)` dotted-underline treatment. This is deliberate: dense academic prose with six colors of link becomes a ransom note. Kind is communicated by (a) the `data-ref-kind` attribute for tooling/tests, (b) an `aria-label` prefix (§8), and (c) the DetailPane header badge once opened — never by prose color.

### 4.2 Name / alias mentions (Phase 2 — rendering contract)

When precomputed mention spans are available for a text, the consuming surface linkifies them **in addition to** the ID-token pass.

- **Visual treatment — distinct from ID-token links.** A name mention is running prose ("OpenAI"), not an identifier, so a dotted underline under every mention is too heavy. Use a **subtle dashed underline in a muted tone** (`text-decoration: underline; text-decoration-style: dashed; text-decoration-color: var(--text-muted); text-underline-offset: 2px;`) with the text color left `inherit`. On hover/focus the underline goes solid and picks up `var(--accent)`. The mention should be legible as plain reading text until the reader looks for links.
- **Confidence gating.** Only link mentions at or above a confidence threshold (proposed default: link `confidence ≥ 0.75`; render lower-confidence spans as plain text). The threshold is a tunable constant, owned with CL — surface it, don't bury it.
- **Overlap precedence.** If a name-mention span overlaps an ID-token span, the **ID-token span wins** (it is exact, not inferred). `scanRefs` output is authoritative; mention spans are trimmed/dropped where they collide. Mention spans among themselves follow the same non-overlapping-leftmost rule.
- **Ambiguity.** A mention the pipeline could not disambiguate to a single entity is **not linked** (refusal discipline — never guess a target). If the pipeline emits an ambiguous mention with candidate set, render it plain in Phase 2; a candidate-picker is a future enhancement, out of scope here.
- **Density cap.** To avoid a wall of underlines, link **only the first mention of a given entity per statement/message block**; subsequent mentions of the same entity in the same block render plain. (Prevents the same name being underlined five times in one paragraph.)

---

## 5. Entity detail view (`case 'entity'` — replaces placeholder)

Renders an `Entity` record inside `.detail-pane-body`. Mirror the `OrganizationDetail` read-mode rhythm (`org-detail-redesign.md`): a compact identity header, a prominent definition, then de-emphasized reference/provenance rows. No raw JSON, no bare IDs in the reading flow.

### Layout (top → bottom)

```
┌ detail-pane-body ─────────────────────────────┐
│ [Redirected from ent-017]        ← only if redirected_from │
│                                                │
│  OpenAI                          ← name (h-level, from title too) │
│  [Institution]  ⬖ non-agentive-social-object   ← type badge + DOLCE chip │
│  also: OpenAI Inc., OpenAI LP    ← aliases row (muted, omit if none) │
│  ● Approved                      ← status pill │
│                                                │
│  An institution that develops    ← description (genus-differentia), │
│  and deploys frontier AI systems…   the hero content; full, unclamped │
│                                                │
│  ─ References ─────────────────                │
│  🔗 openai.com  ↗                ← external_refs as link rows │
│  🔗 Wikipedia  ↗                   (reuse OrganizationDetail ExternalLinkRow) │
│                                                │
│  ─ Appears in ────────────────                 │
│  [doc: 2023-frontier-safety]     ← source_refs as doc chips │
│  [doc: eu-ai-act-analysis]          (clickable if the doc resolves; else labeled) │
│                                                │
│  ─────────────────────────────                 │
│  Discovered by gemini-flash · usage u-4471     ← provenance footer, muted, │
│  Confidence 0.86                                  0.72rem, de-emphasized │
└────────────────────────────────────────────────┘
```

### Field mapping (`Entity` → UI)

| Field | Treatment |
|---|---|
| `name` | Primary heading. Already the pane title (`titleFor`). |
| `entity_type` | Type badge (`person` / `artifact` / `event` / `legislation` / `institution`). Reuse the `od-type-badge` visual. |
| `dolce_category` | Small **DOLCE chip** next to the badge, de-emphasized (muted, `0.72rem`), with the raw category on `title=` hover. Ontology metadata — present but never dominant. |
| `aliases` | Muted "also: a, b, c" row. Omit the row entirely when empty. |
| `status` | Status pill: `proposed` (muted/outline), `approved` (accent/solid), `deprecated` (see below). |
| `description` | **Hero content.** The genus-differentia sentence, full and unclamped, `--text-primary`, comfortable line-height. |
| `external_refs[]` | "References" section; each `{label, url}` as a link row — reuse `OrganizationDetail`'s `ExternalLinkRow` (favicon + label + domain + ↗, opens externally). Omit section if empty. |
| `source_refs[]` | "Appears in" section; each `doc_id` as a chip. Clickable → navigate to that source if a viewer exists; otherwise a labeled, non-interactive chip. Omit if empty. |
| `discovered_by` `{model, usage_id}` + `confidence` | **Provenance footer** — muted, `0.72rem`, below a divider. "Discovered by {model} · usage {usage_id}" and "Confidence {n}". This is curation/audit metadata; keep it out of the reading flow but available. Omit each line whose field is absent. |
| `merged_into` | Not rendered here — the container follows the tombstone and shows the canonical record. See `redirected_from` below. |
| `created_at` / `last_modified` | Not surfaced in v1 (low reader value). Reserve for a possible "⋯ details" affordance later. |

### `deprecated` status

When `status === 'deprecated'`, show a clear inline banner at the top of the body — muted warning tone (not error red): *"This entity is deprecated."* Optionally name a successor if one is known (future). The record still renders in full below the banner.

### `redirected_from`

When the resolved detail carries `redirected_from` (a merge tombstone was followed), show a small muted note at the very top: *"Redirected from {redirected_from}"*. The container has already re-driven selection to the canonical ref via `onSelectRef`; this note just explains why the id the reader clicked differs from the record shown.

---

## 6. Term detail view (`case 'term'` — replaces placeholder) — secondary

Renders a `ColloquialTerm` vocabulary card. Lower priority than the entity view (the vocab/dictionary layer is smaller); ship it in Phase 1 if cheap, else Phase 1.5.

| Field | Treatment |
|---|---|
| `colloquial_term` | Heading (pane title strips the `term:` prefix). |
| `status` (`do_not_use_bare` / `acceptable_in_quotation` / `safe`) | Usage pill with a plain-language label: "Do not use bare", "OK in quotation", "Safe to use". `do_not_use_bare` in a warning tone. |
| `translation_required` | If true, a muted note: "Requires translation to a standardized term." |
| `resolves_to[]` | "Resolves to" list; each `{standardized_term, when, default_for_camp?, confidence_typical?}` as a row: the standardized term (bold) + the `when` condition (muted) + optional camp/confidence chips. This is the substance of the card. |
| `translation_ambiguous_when[]` | "Ambiguous when" muted list, if present. |
| `first_added` / `last_reviewed` | Provenance footer, muted, `0.72rem`. |

Note: `EntityDetail['term'].record` is `ColloquialTerm`. If a future change points `term` at `StandardizedTerm` instead, the field set differs — build the renderer against `ColloquialTerm` as landed and flag any type change to TL.

---

## 7. Entity browser (left-toolbar tool)

A dedicated left-toolbar tool to **display, search, and sort** the full entity set — the counterpart to the existing **Organizations** tab and **Vocabulary** panel. Where inline mentions and the DetailPane answer *"tell me about this entity I'm reading,"* the browser answers *"show me all entities / find one / scan them by type."*

### 7.1 Toolbar registration

Register in `data/navConfig.ts` as a new `NavItem`, mirroring the existing entries:

```
{ id: 'entities', label: 'Entities', icon: Boxes, tier: 'secondary', group: 'browse',
  action: { type: 'togglePanel', target: 'entities' } }
```

- **Icon:** `Boxes` (lucide) — reads as "a collection of things," distinct from Organizations' `Building2`. (Alternatives: `Network` for the ontology/graph connotation, or `Shapes`. Recommend `Boxes`.)
- **Tier/group:** `secondary`, `group: 'browse'` — it is a browse surface; it sits with Situations/Conflicts/Summaries in the browse group of the "more" menu.
- **Panel wiring:** add `'entities'` to the `ToolbarPanel` union in `Toolbar.tsx` and render the panel when `toolbarPanel === 'entities'` — exactly the Edge Browser / Vocabulary `togglePanel` pattern.

### 7.2 Side panel, not a full tab (recommendation)

**Recommended: a `togglePanel` side panel** (like Edge Browser and Vocabulary), where selecting an entity opens the **shared DetailPane** (§5) on the right.

- **One detail view, not two.** The entity detail renderer already lives in the DetailPane (§5). A side panel that drives `setSelectedRef` reuses it verbatim — the browser is the *list*, the DetailPane is the *detail*. A full tab would have to re-render entity detail, duplicating §5.
- **Browse while reading.** Open the entity list beside the transcript/POV/facts without leaving your place — the same ergonomics as Edge Browser.
- **Established pattern.** Edge Browser is exactly list-panel + shared detail; this reuses it.

**Alternative considered — a full "Entities" tab** (`switchTab`, `group: 'tools'`, next to Organizations). It is the closer parallel to Organizations (its sibling entity kind) and gives room for a multi-column sortable table. Rejected as primary only because it duplicates detail rendering and forces a context switch. If the team prefers tab-consistency with Organizations over panel-reuse, this is the fallback — **flag for TL/PM**.

### 7.3 Panel layout & controls

```
┌ Entities ───────────────── [✕] ┐
│ 🔍 Search name, alias, type…    │  ← instant filter
│ Sort: [ Name A–Z ▾ ]            │  ← Name / Type / Status / Confidence / Recently modified
│ Type: ◉all ▫person ▫org …       │  ← facet chips w/ counts (multi-select, collapsible)
│ Status: ▫proposed ▫approved …   │
│ ───────────────────────────    │
│ 142 entities                    │  ← count ("N of M" when filtered)
│ ▸ OpenAI            [Inst]  ●   │  ← row: name · type badge · status dot
│     also: OpenAI Inc.           │      muted second line (alias / description start)
│ ▸ EU AI Act         [Legis] ●   │
│ ▸ p(doom)           [Artf]  ○   │  ← deprecated row de-emphasized
│ …                               │
└─────────────────────────────────┘
```

- **Search** — one box; instant filter over `name` + `aliases` + `id` + `entity_type`. Escape clears.
- **Sort** — a labeled `<select>`: **Name A–Z** (default), Type, Status, Confidence (desc), Recently modified. Applies within the filtered set.
- **Facets** — optional type + status filter chips with live counts (person / artifact / event / legislation / institution; proposed / approved / deprecated). Multi-select, additive, collapsible so the list dominates.
- **Rows** — compact and dense (academic tool): name + type badge + status dot; a muted second line (first alias or start of description). `deprecated` rows de-emphasized. No raw IDs in the row (id available on hover / in the DetailPane).
- **Result count** — "N entities", or "N of M" when filtered.
- **Selection** — clicking a row calls `setSelectedRef({ kind: 'entity', id })`, opening the shared DetailPane (§5). Selected row shows a persistent active state.
- **States** — loading ("Loading…"/skeleton), empty ("No entities match"), error (`EmptyState`).

### 7.4 Data dependency — entity list/query endpoint (does not exist yet)

The single-record path exists (`GET /api/entity/:ref` → `api.getEntity`, t/1786), but **there is no list/search endpoint**. The browser needs one:

- **Server:** `GET /api/entities?search=&sort=&type=&status=` → summary records (id, name, aliases, entity_type, status, confidence, last_modified — enough for rows without shipping every field). Parallels the `getEntity` route.
- **Bridge:** add `listEntities(query)` to `bridge/types.ts` + `web-bridge.ts`, plus the electron IPC handler (parallels the `getEntity` IPC gap, t/1809).
- **Scale:** if `entities.json` is small, load-all-then-filter-client-side is fine (mirrors how the store already holds orgs/policy); if it grows large, move search/sort server-side — the panel contract above is identical either way. **Confirm approach with TL** based on expected entity count.

This is a **server/bridge dependency** — route to TL (endpoint + IPC) alongside the DetailPane consumer work. The browser UI (this spec) builds against `listEntities`.

### 7.5 Accessibility

The list is a keyboard-navigable listbox: `role="listbox"`, rows `role="option"` with `aria-selected`; ↑/↓ move, Enter/Space opens (drives the DetailPane), type-to-search focuses the search box. Search box and sort `<select>` are labeled. Focus returns to the active row when the DetailPane closes. Badges, status dots, and the muted second line meet AA contrast in all four themes (see §8, §9).

---

## 8. Interaction & accessibility

- **Ref-links / mentions are buttons.** Each is a `<button class="ref-link">` (already so for ID tokens). `role=button` is implicit; keyboard activation via Enter/Space is native. Do **not** use a bare `<span>` with an onClick.
- **`aria-label` per link.** `"{Kind}: {display text} — open details"`, e.g. `"Entity: OpenAI — open details"`, so screen-reader users get the kind that sighted users get from context. Kind comes from `data-ref-kind`.
- **Focus ring.** `:focus-visible` shows a visible focus outline (the existing `.ref-link:focus-visible` already promotes the underline to solid + accent; add an outline that meets 3:1 contrast against prose background in all four themes).
- **DetailPane open behavior.** On open (selection change from null), move focus to the pane header/close control so keyboard users land in the pane. **Escape** closes the pane (calls `onClose`). Return focus to the originating link on close.
- **Loading/error announced.** The `loading` and `error` states render in `.detail-pane-body`; wrap the body in `aria-live="polite"` so state changes are announced. "Loading…" already exists; keep it.
- **`not_found`.** Container already renders `EmptyState` "Not found — No {kind} matches "{id}"." No change; ensure it is announced via the same live region.
- **Contrast.** Link treatment, badges, pills, and chips must meet WCAG AA (4.5:1 text, 3:1 UI) in **all four themes** (light, dark, bkc, harvard). Muted provenance text at `0.72rem` must still clear 4.5:1 — verify `--text-muted` on `--bg-primary` per theme; darken the token locally if a theme fails rather than shrinking further.

---

## 9. Visual tokens

Use existing design-system tokens (`docs/ux/design-system.md`). No new palette required for Phase 1.

- **Links:** `var(--accent)` / `var(--accent-strong)` (existing `.ref-link`).
- **Surfaces:** `--bg-primary` (body), `--bg-secondary` (header), `--border`.
- **Text:** `--text-primary` (name, description), `--text-muted` (aliases, DOLCE chip, provenance).
- **Badges / pills / chips:** reuse `OrganizationDetail`'s `od-type-badge` and chip styles; do not invent parallel classes. Status pill tones: approved → accent; proposed → outline/muted; deprecated → muted warning.
- **New tokens:** none needed. If a later phase color-codes kinds (not recommended for prose — see §4.1), add `--color-entity` / `--color-term` to the design system across all four themes at that time, and update this spec + the design system together.

---

## 10. Acceptance criteria (Design sign-off)

Verified visually via electron-mcp (per `/design-review-workflow`) before the design ticket is marked Done:

1. Clicking an entity ID-token ref in the transcript opens the DetailPane with the **rich entity view** (no "coming soon" placeholder) — name, type badge, DOLCE chip, description, and any external/source refs render correctly.
2. `status` pill reflects the record; `deprecated` shows the banner; `redirected_from` shows the redirect note when a tombstone is followed.
3. Term ID-token ref opens the rich term view (or Phase-1.5 fallback is explicitly deferred and tracked).
4. Provenance footer (`discovered_by`, `confidence`) renders muted and below the divider; absent fields omit their line, not render "undefined".
5. `not_found`, `loading`, and `error` states render and are announced.
6. All link treatments, badges, pills, and text clear WCAG AA contrast in **all four themes**.
7. Keyboard: Tab reaches every ref-link; Enter/Space opens; Escape closes; focus returns to the originating link.
8. No raw JSON and no bare entity IDs appear in the reading flow (IDs only in the muted provenance/usage context).
9. The **Entities** toolbar tool opens a panel that lists entities, filters them via the search box, and re-sorts via the sort control; selecting a row opens the entity DetailPane (§5) with a persistent active state; keyboard listbox navigation works (↑/↓/Enter).

---

## 11. What NOT to do

- **No client-side NER / live name matching.** Name mentions come from precomputed annotations only (§4.2). The renderer never scans prose for entity names.
- **No per-kind color-coding of prose links** (§4.1) — one link treatment, kind via label/badge.
- **No new DetailPane container / modal / popover.** The right-hand pane exists; render body content into it.
- **No duplicate entity-detail rendering in the browser** (§7). The browser lists and filters; selecting a row drives the shared DetailPane (§5). Do not fork a second entity detail view into the panel.
- **No editing.** These are read-only views (`readOnly` like `NodeDetail`/`SituationDetail`). Curation/disposition of entities is a separate admin surface, not this pane.
- **Do not restate the data model.** Consume `Entity` / `ColloquialTerm` from `lib/entities/types.ts` and `lib/dictionary/types.ts`; a fork of the contract is a bug.
- **Do not surface `created_at` / `last_modified` / `merged_into` / raw `dolce_category`** in the primary reading flow.

---

## 12. Open questions (for CL / TL / Requirements)

1. **Mention annotation format & transport (Phase 2)** — CL to confirm the emitted span shape (`{start, end, ref, confidence, ambiguous?}`) and which corpora carry it first (facts → POV → debate → chat, per t/1767). TL to confirm store/bridge path. Blocks Phase 2.
2. **Confidence threshold** for linking name mentions — proposed `≥ 0.75`; CL owns the number.
3. **`source_refs` navigation** — is there a doc/source viewer a source chip can open to? If not, chips are labeled-only in v1 (Requirements/TL).
4. **Term layer priority** — ship the term view in Phase 1 or defer to 1.5? (PM/Requirements.)
5. **Ticket attachment** — this UX half is cross-referenced by both t/1766 (rendering) and t/1767 (data, Done). Confirm the implementation ticket it lands under before TL decomposition.
6. **Entity list endpoint** — `GET /api/entities` (search / sort / filter) does not exist yet (§7.4). TL: client-side-filter vs. server-side query, and the summary row shape. Blocks the entity browser (§7), not the detail renderers.
7. **Browser: panel vs. tab** — recommend a `togglePanel` side panel that reuses the DetailPane; the Organizations-style full `switchTab` tab is the alternative (§7.2). TL/PM to confirm.
