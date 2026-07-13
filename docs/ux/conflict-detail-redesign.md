# Conflict Detail — Redesign

**Author:** Design (Orca)
**Status:** Ready for implementation
**Evidence base:** owner screenshot 2026-07-12 ("Andreessen Manifesto Publication" conflict).
**Relationship to `de-engineering-pass.md` (t/1414):** §2 of that spec states the read-mode rule for this screen; this document is the full redesign and **supersedes that section**. Implement this spec; t/1414 §2 is satisfied by it.

---

## 1. Diagnosis

1. **The page is a form.** Claim Label input, Status dropdown, Description textarea, per-instance Document ID inputs, Assertion textareas, and date pickers are always in edit state. Reading a conflict means reading through input chrome, and a page-level Save button governs everything.
2. **Red banner misuse.** `CONFLICT : ANDREESSEN MANIFESTO PUBLICATION` renders as a full-width red alert. Red means danger/error in this app; an open conflict is a normal object, not an incident. The banner also duplicates the Claim Label field directly beneath it.
3. **ID-first chips.** Linked Taxonomy Nodes lead with `acc-intentions-067`-style mono IDs; two chips show only the ID with no label at all. Each chip carries ▾ and ✕ controls even when the user is just reading.
4. **Policy chip wall.** Thirteen Related Policies chips, ID-first, text truncated mid-sentence, all equal weight.
5. **Instances are giant sub-forms.** Each instance spends ~350px on four boxed fields. The evidence itself (assertion + stance + source) is a few lines of content.
6. **Toolbar mixes verbs.** Research / Debate / Pin / Done on the left, Delete on the right. "Done" is a status change dressed as a navigation button; Delete is fine but Done's placement implies it's routine.

## 2. Redesigned layout (read mode)

```
┌────────────────────────────────────────────────────────────────────┐
│ [Research] [Debate] [Pin]                                    [⋯]  │
│                                                                    │
│ CONFLICT · ○ Open                                                  │
│ Andreessen Manifesto Publication              (serif page title)   │
│ First flagged Mar 31, 2026 · 2 instances                           │
│                                                                    │
│ Marc Andreessen published a manifesto titled 'The Techno-          │
│ Optimist Manifesto' on the Andreessen Horowitz website.  (prose)   │
│                                                                    │
│ LINKED TAXONOMY NODES                                              │
│ ▎Remove Barriers and Increase Funding to Acc…  acc-intentions-052  │
│ ▎Accelerate AI Through Open, Decentralized, a… acc-intentions-114  │
│ ▎Absorb All Human Knowledge into AI            acc-desires-010     │
│ ▎Shift Organizations from Periodic Reviews to… acc-intentions-059  │
│ ▎(unlabeled node)                              acc-intentions-067  │
│ [＋ Link node]                                                     │
│                                                                    │
│ RELATED POLICIES (13)                                              │
│ Establish public-private partnerships to digitize a…    pol-1030   │
│ Develop open standards and protocols for knowl…        pol-1031   │
│ …two-column compact list…                                          │
│                                                                    │
│ INSTANCES (2)                                                      │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ Supports · marc-andreessen-manifesto-says-…-2026 · Mar 31     │  │
│ │ "Marc Andreessen published a manifesto titled 'The           │  │
│ │  Techno-Optimist Manifesto' on the Andreessen Horowitz       │  │
│ │  website."                                    (serif quote)   │  │
│ └──────────────────────────────────────────────────────────────┘  │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ Supports · …-2026-1 · Mar 31                                  │  │
│ │ "…manifesto on the a16z website … lists various societal     │  │
│ │  concepts as 'enemies' of technological progress."            │  │
│ └──────────────────────────────────────────────────────────────┘  │
│ [＋ Add instance]                                                  │
└────────────────────────────────────────────────────────────────────┘
```

## 3. Section specs

### 3.1 Header
- **Eyebrow line:** `CONFLICT` in the small uppercase-tracked label style (`--text-xs`, `letter-spacing 0.06em`, `var(--text-muted)`) followed by the **status chip**. No red banner.
- **Status chip is the status control.** `○ Open` (neutral outline), `⚠ Escalated` (`--warning`) if that state exists, `✓ Done` (`--success`). Clicking the chip opens a small menu with the status options. This replaces both the Status dropdown and the toolbar "Done" button.
- **Title:** the claim label as the serif page title (same recipe as node detail headline). Click-to-edit (see §4).
- **Meta line:** `First flagged {earliest instance date} · {n} instances` in `--text-xs` muted. Derived, not stored.

### 3.2 Toolbar
- Left: Research, Debate, Pin (existing behaviors, existing button styles).
- Right: one `⋯` overflow menu containing **Delete** (with the existing confirm) and any rare actions. Destructive actions do not sit at the same level as primary verbs.
- "Done" button removed (absorbed into the status chip).

### 3.3 Description
- Read mode: `.prose`-treated paragraph (serif when elevation fonts land; comfortable line-height now). No box.
- Click-to-edit swaps to the textarea, Save/Cancel per field (Escape cancels).

### 3.4 Linked Taxonomy Nodes
- **Rows, not chips.** One row per node: 3px left tick in the node's camp color, then the **human label** as primary text, then the mono ID as a muted `--text-2xs` suffix. Rows are click-to-navigate (same target as today's chip click).
- Nodes whose label hasn't loaded render `(unlabeled node)` + ID rather than a bare ID chip, so a missing label looks missing instead of normal.
- The ▾ (stance/expand) and ✕ (unlink) controls appear on row hover/focus only; always present in edit contexts, never at rest.
- `＋ Link node` row at the end replaces the always-open "Search nodes…" input; clicking it reveals the search input in place.

### 3.5 Related Policies
- Compact **two-column list** (single column under tablet width), each row: policy title (primary, may wrap to 2 lines, never mid-word truncation) + `pol-NNN` muted mono suffix. Click-to-navigate.
- Section header carries the count: `RELATED POLICIES (13)`.
- If more than ~10, show the first 8 with a `Show all (13)` toggle. The wall of chips is what we're deleting; don't recreate it as a wall of rows.

### 3.6 Instances
- Each instance becomes an **evidence card**: `--radius-md`, 1px border, `--sp-4` padding.
  - **Meta line first:** stance chip (`Supports` in the `--success` family, `Refutes` in the `--danger` family; the one legitimate use of those colors here) · document ID as a muted mono link · flagged date (`Mar 31, 2026`).
  - **Assertion as a quotation:** serif, quoted, `--text-md`. This is the evidence; give it the reading treatment.
  - Delete-instance (trash) appears on card hover/focus, uses the inline-confirmation pattern.
- Click-to-edit per field within a card (document ID, stance, assertion, date), same mechanics as §3.3.
- `＋ Add instance` appends a new card directly in edit state.

## 4. Edit model (page-wide)

- **Per-field click-to-edit**, not a page-wide form. A field in edit state shows its input + Save/Cancel; Escape cancels; saving one field doesn't touch others.
- The bottom Save bar disappears in read mode; if the current save API is page-level, keep one Save bar that appears **only when at least one field is dirty** (functional equivalence without permanent form chrome). Implementer's choice; state which in the completion comment.
- Keyboard: every editable region is focusable, `Enter` to edit, visible focus ring.
- **No data-flow changes.** Same fields, same validation, same save endpoint. Presentation and interaction only; flag TL if the edit-state restructuring forces more.

## 5. What NOT to do

- No red anywhere except destructive actions and `Refutes` stances.
- No new components where an existing recipe fits (status menu = existing popover; evidence card = existing card tokens; inline confirm = existing pattern).
- Do not hide the IDs; demote them. Researchers still copy them.
- Do not paginate instances; conflicts have few.

## 6. Acceptance

1. No visible input boxes, dropdowns, or date pickers in read mode; red banner gone; claim label is the serif page title with eyebrow + status chip.
2. Status changes via the chip menu; Done button gone; Delete lives in the overflow menu.
3. Node and policy rows lead with human labels, IDs as muted suffixes; no mid-word truncation without a full-title tooltip; unlink/expand controls hidden at rest.
4. Instances render as evidence cards (stance chip + quoted assertion + source meta); add/edit/delete all still work.
5. All four themes verified; keyboard-accessible editing; before/after screenshots (light + dark) attached for Design review.
