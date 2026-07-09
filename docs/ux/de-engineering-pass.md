# De-Engineering Pass — Read Surfaces, Chips, IDs, and Instrument Polish

**Author:** Design (Orca)
**Status:** Ready for implementation (single-ticket pass)
**Evidence base:** 11 owner screenshots (2026-07-08) of Debate Diagnostics (statement detail, Brief, Claims/Taxonomy Refs, Commitments, Extraction, Grounding, Prompt Diff, Flight Recorder), Situations detail, and Conflicts detail.
**Context:** post-D1/D4 review. Grouped sidebar, reduced tab strip, light Extraction cards, serif node headlines, and the labeled rail have landed and read well. This spec covers the remaining "engineer designed it" tells NOT already ticketed (scores are t/1386, prompt dumps and charts are t/1389). Eight items, one pass.

**Restraint rule applies throughout:** every item below removes emphasis rather than adding it. When in doubt, remove.

---

## 1. Situations detail: read mode is a page, not a form

**Tell:** the Safetyist/Accelerationist/Skeptic tabs render SUMMARY / BELIEF / DESIRE / INTENTION each as a bordered textarea box even when the user is only reading. The edit form doubles as the display.

**Fix:**
- Read mode renders each field as typeset prose: no border, no box, no input affordance. Field labels stay as small uppercase-tracked captions (`--text-xs`, `letter-spacing: 0.06em`, `var(--text-muted)`) above the text.
- Body text: `--text-md` minimum, comfortable line-height; adopt `.prose` treatment when elevation Phase 2 lands (do not block on it).
- Editing becomes explicit: clicking the text (or a pencil affordance on hover/focus) swaps that field to its input. Save/cancel per field, or one Edit toggle for the whole tab if per-field is structurally awkward. Implementer's choice; state which in the completion comment.
- Keyboard: the click-to-edit target must be focusable (`Enter` to edit, `Escape` to cancel) with a visible focus ring.

## 2. Conflicts detail: same read-mode treatment

**Tell:** the Conflict view is literally a form as the primary reading surface: Claim Label input, Description textarea, Status dropdown, Date Flagged date-picker, Assertion textarea.

**Fix:**
- Same read-mode rule as §1: claim label becomes the page title (serif headline recipe used by node detail), description and assertion become prose blocks, status and date become a quiet meta line (chip + date text) under the title.
- Linked Taxonomy Nodes and Related Policies chips stay, but human label leads and the ID moves inside the chip as a `--text-2xs` mono suffix (see §4).
- The left cluster list: conflict titles render in normal text color, not red mono. Red in a list reads as "error log." Camp/status accents may color a 3px left tick, not the text.
- Delete stays in the toolbar but visually separated from Research/Debate/Pin (overflow menu or right-aligned with a divider). Destructive actions do not sit shoulder-to-shoulder with primary actions.

## 3. Exception-only chips (diagnostics tables and lists)

**Tell:** the same chip is stamped on every row: `QUALITY` four times in one caveat list (statement detail), green `OK` on all 14 Extraction rows, camp name repeated down whole columns.

**Fix — one rule:** a status chip appears only when the row deviates from the default. `OK`/pass rows get nothing (the absence is the signal). Repeated category labels (`QUALITY`, camp names in single-camp sections) appear once in the section header, not per row.
- Extraction table: keep the Status column but render pass as a dim `–` or empty; only warnings/rejects get a chip.
- Caveat lists: drop the per-item `QUALITY` chip; the section header says "Quality caveats (4)".
- Where a column would become entirely empty, remove the column.

## 4. IDs quieter than names (app-wide rule, diagnostics worst offender)

**Tell:** machine identifiers (`saf-beliefs-217`, `acc-intentions-027`, the full debate UUID in the diagnostics title bar) render colored, underlined, or bolded while the human label sits in plain text.

**Fix:**
- Human label is the primary text everywhere; the ID is a `--text-2xs` mono suffix in `var(--text-muted)`. IDs remain clickable/copyable but stop carrying the visual weight.
- Diagnostics title bar: collapse the debate UUID to its last 6 characters with click-to-copy for the full value (`…4ba3d5 ⧉`).
- Camp color stays on the label or a left tick when identity matters; it leaves the ID text.

## 5. Heading hierarchy in diagnostics panels

**Tell:** every heading level is the same small orange uppercase, and section headers embed content ("▼ Dialectical Moves — UNDERCUT, DISTINGUISH, REFRAME").

**Fix:**
- Two levels only. Panel title: `--text-md`/1.0625rem-equivalent, weight 600, normal case, `var(--text-primary)`. Section label: the existing small uppercase-tracked style, `var(--text-muted)` (not orange; reserve accent color for interactive elements).
- Headers name the section; content moves to the body. "Dialectical Moves" is the header; the move names render as body chips/text beneath it.
- Collapse chevrons keep working; they attach to the section label style.

## 6. Claim coverage strip (Claims/Taxonomy Refs view)

**Tell:** "AN Claim Coverage" renders 30+ consecutive `AN-n` text links in a wrapping row. Unusable as navigation, unreadable as data.

**Fix:** replace with a coverage strip: one small square per claim (12px, `--radius-sm`, 3px gap), fill tinted by strength (strong = solid `var(--success)`-family tint, weak = 40% tint, uncovered = `var(--bg-hover)` outline only). Tooltip shows `AN-n · strength · claim excerpt`; click scrolls to/opens the claim. Keep the "Strong (n) / Weak (n)" summary text beside the strip. Same data, one glance, one row.

## 7. Prompt Diff: document comparison, not raw git diff

**Tell:** full-saturation red/green/yellow slabs over tiny mono, edge to edge — a terminal dump in a window.

**Fix:**
- Change highlights become 8–10% tints (`color-mix` with the theme background) with a 2px solid left edge per change type: added = success edge, removed = danger edge, modified = `--warning` edge. Text stays `var(--text-primary)`; never colored text on colored slab.
- Each run column gets a header card: run label, model, timestamp (data already exists in the run metadata).
- Unchanged regions collapse to `⋯ n unchanged lines` toggles (same interaction as ArtifactBlock in t/1389; reuse its style if it has landed, otherwise a simple centered toggle row).
- Mono stays, but at `--text-2xs` minimum (11px), not below.

## 8. Flight Recorder: card grid, not config printout

**Tell:** a two-column key-value dump with orange group headers.

**Fix:**
- Each group (APP, SBOM, WINDOWS, DEBATE, TAXONOMY, AI, PERFORMANCE) becomes a card: `--radius-md`, `1px solid var(--border-color)`, `--sp-4` padding, group name as the section-label style from §5. Cards flow in a responsive two-column grid (`--sp-4` gap), single column under tablet width.
- Values right-aligned in mono; keys in `var(--text-secondary)`.
- Zero/empty values (the all-zero TAXONOMY block) render in `var(--text-muted)` so populated data stands out.

## 9. Empty states (Situations "Supporting Evidence" and equivalents)

**Tell:** "No linked nodes for this perspective" as plain muted text — an apology, not an invitation.

**Fix:** apply the EmptyState recipe (elevation doc §7): one-line headline (`--text-md`, 600) + one-line direction + the existing action ("Add safetyist node…" input stays). Example: **No supporting evidence yet** / "Link a safetyist node to ground this perspective." Reuse the same recipe for any other empty panel this pass touches; do not build a new component per panel.

---

## Guardrails

- All colors via theme tokens; verify all four custom themes (light/dark/BKC/Harvard). No hardcoded hex.
- No renames of test-referenced CSS classes; add, restyle, deprecate.
- No new dependencies.
- Read-mode changes (§1, §2) must not alter save behavior, validation, or data flow. They are presentation and interaction pattern only. If a structural change to edit state management is needed, flag TL before proceeding.
- Deliberate non-goal: do NOT cap line length in diagnostics prose (owner direction: content uses the window, t/1395). Compensate with line-height (≥1.5 on analysis text) and the 11px floor.

## Acceptance (whole pass)

1. Situations and Conflicts detail read as typeset pages in read mode; no visible input boxes until the user edits; keyboard-accessible edit affordances.
2. No diagnostics table/list stamps an identical chip on every row; pass states are visually silent.
3. No machine ID renders with more visual weight than its human label; diagnostics title bar UUID is collapsed with copy.
4. Diagnostics panels show two distinct heading levels; accent color no longer used on non-interactive headers.
5. Claim coverage renders as the square strip with tooltips and click-through.
6. Prompt Diff uses tinted edges + collapsed unchanged regions + per-run header cards.
7. Flight Recorder renders as the card grid with de-emphasized empty values.
8. Empty states touched by this pass use the EmptyState recipe.
9. Screenshots of each changed surface (light + dark minimum) attached for Design review.
