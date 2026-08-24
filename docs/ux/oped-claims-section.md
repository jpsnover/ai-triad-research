# Op-Ed Claims Section + Per-Element Claim Linkage

**Last updated:** 2026-08-20
**Author:** Design (Orca)
**Status:** Spec — approved direction (TL decisions t/2890#1); UI spec for implementation
**Ticket:** t/2890 (feature)
**Implements:** the "Claims" section + per-element claim child in the op-ed study view
**Mirrors:** the existing `GroundingSection` in `taxonomy-editor/src/renderer/components/opeds/OpEdReader.tsx` (+ `OpEdReader.css`)

---

## 1. Context

The op-ed study view already shows a **"Taxonomy grounding"** section (`GroundingSection` in `OpEdReader.tsx`): a native `<details open>` disclosure whose summary reads `Taxonomy grounding (N elements)`, containing a table (Element / Relevance / Reflected in the op-ed). Each element id is a `<button aria-expanded>` that expands an inline `GroundingDetailCard` — which **already** renders `ref.document_claims` under *"Addresses these source claims:"*.

Two enhancements (t/2890):

1. **Feature 2 — a new "Claims" section** listing *all* claims the AI extracted from the source op-ed (not only those that matched a taxonomy element), as a peer to Taxonomy grounding.
2. **Feature 1 — per-element claim linkage**: each grounding element's expanded card should show *which* claim it responds to. This largely exists via `document_claims`; the enhancement is the paragraph reference + an optional cross-link to the numbered claim.

The design principle: the Claims section and the grounding section must **read as one system** — same disclosure pattern, same tokens, same chip styling — so this is a mirror, not a new visual language.

## 2. Data contract (per TL, t/2890#1 — additive, backward-compatible)

The grounding response gains a top-level `claims` array:

```ts
claims: { text: string; paragraph: number }[]
```

- One AI call (the grounding prompt co-returns `claims`), not a second pass.
- **Backward-compatible:** absent or empty `claims` ⇒ render nothing new (no regression to the existing grounding display). The UI must not assume the field exists.
- Flat list with a paragraph index per claim (the UI can group by paragraph; the backend need not).

## 3. Feature 2 — the Claims section

- A collapsible section mirroring `.oped-grounding`: `<details open>` with `<summary class="oped-claims-summary">Claims ({claims.length})</summary>`.
- **Placement: directly ABOVE the Taxonomy-grounding `<details>`** (TL Q3 — claims are the raw analytical *input*; taxonomy grounding is the derived *output*; input→output ordering reads more clearly).
- Body: an **ordered list** `<ol class="oped-claims-list">`, one `<li class="oped-claim-item">` per claim, numbered 1..N. **The `<ol>` supplies the canonical claim numbering** that the per-element linkage (§4) references.
- Each item shows:
  - the claim **text** (plain text; wraps, never truncated — claims are the analytical substance);
  - a **paragraph badge** — a small pill `¶{paragraph}` (`.oped-claim-para`) reusing the chip styling already used in `.oped-grounding-card` (border `--border-color`, muted text, `--radius-sm`), with `title` / `aria-label` = `"Paragraph {n}"`. Badges repeat if several claims share a paragraph.
- **Empty / absent:** when `claims` is missing or empty, **omit the section entirely** — do not render an empty shell. (Same spirit as the grounding section, which only appears when it has a grounding array; its own empty case shows the voice-only line.)

## 4. Feature 1 — per-element claim child (enhance the existing card)

`GroundingDetailCard` already lists `document_claims` under *"Addresses these source claims:"*. Enhance it:

- Keep the label; render each claim with the **same `¶{paragraph}` badge** once `document_claims` carries paragraph info.
- **Cross-reference (nice-to-have):** show the claim's number from the Claims section — e.g. **`Claim #{k}` · ¶{p} — {excerpt}** — so a reader can trace an element back to the numbered claim above. Deriving `#k`:
  - If the backend supplies a claim **index** per element, use it (cleanest).
  - Otherwise the UI matches the element's `document_claims` text against the flat `claims` list to recover the number.
  - If no match is found, fall back to just the text + `¶` badge. **The UI must not require the index** — it degrades gracefully.
- No change to the grounding **table** itself; the linkage stays inside the existing inline expand card.

## 5. Visual & tokens

- New classes: `.oped-claims`, `.oped-claims-summary`, `.oped-claims-list`, `.oped-claim-item`, `.oped-claim-para` — mirror `.oped-grounding*` spacing/typography.
- **Tokens only — no new tokens, no hard-coded hex.** The `¶` paragraph pill reuses the existing grounding-card chip tokens (`--border-color`, `--text-muted`/`--text-secondary`, `--radius-sm`).
- Both sections are `<details>` disclosures with the same summary affordance, stacking as peers: **Claims → Taxonomy grounding.**
- All four themes (light / dark / bkc / harvard) inherited via tokens, exactly like the grounding section.

## 6. Accessibility

- Native `<details>` / `<summary>` gives disclosure semantics + keyboard toggle (Enter/Space) for free — same as grounding; **no custom ARIA needed** for the section.
- `<ol>` conveys the numbered-list semantics; the `¶` badge must carry a text label (`title` / `aria-label` = "Paragraph N") — do not rely on the `¶` glyph alone.
- Claim text wraps (no truncation).
- Reduced motion / contrast inherited from the theme tokens.

## 7. Acceptance

1. A collapsible **"Claims (N)"** section renders **above** Taxonomy grounding, listing all `claims` as a numbered list with text + a paragraph badge per claim.
2. Absent / empty `claims` → the section is **omitted**, with no regression to the existing grounding display.
3. Each grounding element's expanded card shows the claim(s) it addresses with paragraph badges (and the claim number when derivable).
4. Tokens only; renders correctly in all four themes; native `<details>` keyboard a11y; the paragraph badge has an accessible label.
5. **Design signs off via `/design-review-workflow`** before Done.

## 8. What NOT to do

- Do **not** make `claims` required — it's an additive field; absence must render exactly today's UI.
- Do **not** introduce new tokens or hard-coded colors for the paragraph badge — reuse the grounding-card chip tokens.
- Do **not** require a backend claim-index for the per-element cross-reference — derive-or-degrade.
- Do **not** replace the grounding section's `<details>`/table pattern — the Claims section mirrors it; it does not restyle it.
- Do **not** render an empty "Claims" shell when there are no claims — omit the whole section.

---

*Scope note:* the implementation (grounding prompt + schema extension, and this UI) is a coding-agent task (unowned `taxonomy-editor` → routed to TL); this document is the Design UI spec for it. Design reviews the result via `/design-review-workflow`.
