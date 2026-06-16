# Regenerate Phrases Toggle — UX Spec

**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Add a "Regenerate phrases" opt-in toggle to the reflection EditCard for edits to existing POV items ("revise" and "qualify" types). Currently, when an edit is approved, synthetic phrases and embeddings are always regenerated via fire-and-forget enrichment. This toggle makes phrase regeneration explicit and default-off for existing node edits.

**Rationale:** Minor wording tweaks or description clarifications don't warrant regenerating all synthetic phrases (an AI call + embedding computation). Users should opt in when the edit is substantive enough to invalidate existing phrases.

## Scope

- **Applies to:** `revise` and `qualify` edit types (which modify existing nodes)
- **Does NOT apply to:** `add` (new nodes always need phrases) or `deprecate` (retiring items, no phrases needed)

## Design

### Toggle placement

Add a small toggle row between the diff/edit area and the action buttons, visible only for `revise`/`qualify` edits on unresolved cards:

```
┌──────────────────────────────────────────┐
│  ✏️ Revise  saf-desires-042              │
│  Confidence: high                        │
├──────────────────────────────────────────┤
│  Label: Ensuring Fiduciary Oversight...  │
│  Description: (diff or edit area)        │
├──────────────────────────────────────────┤
│  ☐ Regenerate phrases                    │  ← NEW: toggle row
├──────────────────────────────────────────┤
│  [Approve & Apply]  [Reset]  [Dismiss]   │
└──────────────────────────────────────────┘
```

### Visual treatment

- **Checkbox** — standard HTML checkbox, not a toggle switch. Checkboxes better convey "opt-in to an optional side effect" vs. toggle switches which imply a persistent setting.
- **Label text:** "Regenerate phrases" — no icon, no tooltip needed. The phrase is self-explanatory in context.
- **Font:** `0.72rem`, `var(--text-secondary)` — subordinate to the action buttons, clearly secondary.
- **Spacing:** `margin-top: 6px; margin-bottom: 4px` — sits between content and actions without crowding either.
- **Default:** Unchecked (off).

### State flow

1. User reviews a `revise` or `qualify` edit
2. Checkbox appears unchecked below the edit area
3. If user checks it, the `Approve & Apply` action passes `regeneratePhrases: true` to `applyReflectionEdit`
4. `applyReflectionEdit` uses this flag to decide whether to include synthetic phrases/embeddings in the enrichment call
5. Graph attributes (epistemic_type, rhetorical_strategy, etc.) are always enriched regardless of this flag — only the synthetic_phrases + embedding computation is gated

### Behavior details

- **Checkbox resets** when the edit card resets (user clicks "Reset")
- **Checkbox hidden** once the edit is resolved (approved or dismissed)
- **For `add` edits:** No checkbox — phrases always generated for new nodes
- **For `deprecate` edits:** No checkbox — no enrichment runs at all
- **Batch approve:** When batch-approving a POV's edits, use the default (off). Users who want phrase regeneration should approve individually.

## Implementation notes

### ReflectionsPanel.tsx — EditCard

Add local state:
```
const [regenPhrases, setRegenPhrases] = useState(false);
```

Render checkbox (between evidence/diff area and action buttons, only for revise/qualify):
```
{!resolved && (edit.edit_type === 'revise' || edit.edit_type === 'qualify') && (
  <label style={{ display: 'flex', alignItems: 'center', gap: 6,
    fontSize: '0.72rem', color: 'var(--text-secondary)',
    marginTop: 6, marginBottom: 4, cursor: 'pointer' }}>
    <input type="checkbox" checked={regenPhrases}
      onChange={e => setRegenPhrases(e.target.checked)} />
    Regenerate phrases
  </label>
)}
```

Pass flag to apply call:
```
await applyReflectionEdit(pover, editIndex, overrides, { regeneratePhrases: regenPhrases });
```

Reset on handleReset:
```
setRegenPhrases(false);
```

### debateLoopSlice.ts — applyReflectionEdit

Add optional 4th parameter:
```
applyReflectionEdit: async (
  pover: string,
  editIndex: number,
  overrides?: { label?: string; description?: string },
  options?: { regeneratePhrases?: boolean }
) => { ... }
```

Gate the synthetic phrases block (lines ~1819-1839):
- For `add` edits: always generate phrases (ignore the flag)
- For `revise`/`qualify` edits: only generate phrases if `options?.regeneratePhrases` is true
- Graph attribute enrichment (lines ~1789-1817) always runs regardless

Specifically, wrap the phrases block:
```
const shouldRegenPhrases = edit.edit_type === 'add' || options?.regeneratePhrases;

if (shouldRegenPhrases && phrasesToEmbed.length > 0) {
  // existing embedding computation logic
}
```

## Integration points

| File | Change |
|---|---|
| `ReflectionsPanel.tsx` EditCard | Add `regenPhrases` state, checkbox UI, pass flag to apply |
| `debateLoopSlice.ts` `applyReflectionEdit` | Add `options` parameter, gate synthetic phrases on flag |
| `debateLoopSlice.ts` types (if separate) | Update `applyReflectionEdit` signature |

## What NOT to do

- No toggle on `add` edits — new nodes must have phrases
- No toggle on `deprecate` — no enrichment runs
- No global setting or persistent preference — this is a per-edit decision
- No confirmation dialog — the checkbox is the confirmation
- No tooltip explaining what synthetic phrases are — the audience (researchers using this tool) knows

## Accessibility

- Standard `<label>` wrapping `<input type="checkbox">` — native keyboard and screen reader support
- Label text provides sufficient context — no `aria-label` needed
