# Reflection Edit Card — Edit Before Approve

**Status:** Spec ready for implementation
**Owner:** Design
**Implementer:** Taxonomy Editor

## Problem

The ReflectionsPanel EditCard offers only "Approve & Apply" (accepts the AI proposal verbatim) or "Dismiss" (rejects entirely). Users frequently want to accept the spirit of a suggestion while tweaking phrasing, adjusting scope, or removing a clause. There is no way to do this without dismissing and manually editing.

## Solution

Add an **Edit** affordance to each EditCard that transforms the PROPOSED section into an editable textarea, allowing the user to modify both label and description before approving.

## States

### 1. Review State (default — no changes to current behavior)

Everything stays as-is. One addition: a small **Edit button** (pencil icon or text) in the PROPOSED section.

```
┌─────────────────────────────────────────────────┐
│ [Revise]  Intentions  skp-I-042  [High]         │
├─────────────────────────────────────────────────┤
│ Old Label → Proposed Label                      │
│                                                 │
│ ┌─ CURRENT (red border-left) ─────────────────┐ │
│ │ An Intention within skeptic discourse...    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ PROPOSED (green border-left) ──── [✏ Edit] ┐ │
│ │ An Intention within skeptic discourse that  │ │
│ │ advocates for [highlighted changes...]      │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Rationale (italic, muted)                       │
│ Evidence: Cassandra (S13)  Sentinel (S14)       │
│                                                 │
│ [Approve & Apply]  [Dismiss]                    │
└─────────────────────────────────────────────────┘
```

**Edit button placement:** Right-aligned within the PROPOSED box header row, next to the "PROPOSED" label. Small, ghost-styled. Only visible when `status === 'pending'`.

### 2. Edit State (after clicking Edit)

The PROPOSED section transforms:
- Label becomes an editable text input (pre-filled with `proposed_label`)
- Description becomes an editable textarea (pre-filled with `proposed_description`)
- Diff highlights are removed (plain text in the textarea)
- Section label changes from "PROPOSED" (green) to "EDITED" (blue)
- A "Modified" badge appears when content differs from the original proposal
- CURRENT section stays visible for reference

```
┌─────────────────────────────────────────────────┐
│ [Revise]  Intentions  skp-I-042  [High]         │
├─────────────────────────────────────────────────┤
│ Old Label → ┌─────────────────────────────────┐ │
│             │ Proposed Label (editable)       │ │
│             └─────────────────────────────────┘ │
│                                                 │
│ ┌─ CURRENT (red border-left) ─────────────────┐ │
│ │ An Intention within skeptic discourse...    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ EDITED (blue border-left) ── Modified ─────┐ │
│ │ ┌─────────────────────────────────────────┐ │ │
│ │ │ An Intention within skeptic discourse   │ │ │
│ │ │ that advocates for legally mandated...  │ │ │
│ │ │                                         │ │ │
│ │ │ [editable textarea, auto-height]        │ │ │
│ │ └─────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Rationale (italic, muted)                       │
│ Evidence: Cassandra (S13)  Sentinel (S14)       │
│                                                 │
│ [Approve & Apply]  [Reset]  [Cancel]  [Dismiss] │
└─────────────────────────────────────────────────┘
```

### Element Details

| Element | Details |
|---------|---------|
| **Section label** | "EDITED" in blue (`#3b82f6`), replacing green "PROPOSED" |
| **Border-left** | Changes from green (`rgba(34,197,94,0.3)`) to blue (`rgba(59,130,246,0.3)`) |
| **Background** | Changes from green tint (`rgba(34,197,94,0.06)`) to blue tint (`rgba(59,130,246,0.06)`) |
| **"Modified" badge** | Small pill (blue bg, white text, `fontSize: 0.6rem`). Visible only when label or description differs from original proposal |
| **Label input** | Text input replacing the static label display. Same font size as the current label (0.75rem, fontWeight 600) |
| **Description textarea** | Replaces the diff-highlighted text. Auto-heights to content. Same font/padding as the read-only box. Border: `1px solid var(--border-color)`, border-radius 4px |
| **Reset button** | Reverts both label and description to original proposal. Ghost style. Only visible when modified |
| **Cancel button** | Exits edit mode, returns to Review state. Discards all edits |
| **Approve & Apply** | Applies the *edited* text (or original if unmodified). Same primary button style |
| **Dismiss** | Unchanged |

## Component State

```tsx
// In EditCard component — add local state:
const [editing, setEditing] = useState(false);
const [editedLabel, setEditedLabel] = useState(edit.proposed_label);
const [editedDescription, setEditedDescription] = useState(edit.proposed_description);

const isModified = editedLabel !== edit.proposed_label
                || editedDescription !== edit.proposed_description;

const handleReset = () => {
  setEditedLabel(edit.proposed_label);
  setEditedDescription(edit.proposed_description);
};

const handleCancel = () => {
  handleReset();
  setEditing(false);
};
```

## Store Change

The `applyReflectionEdit` action in `useDebateStore.ts` needs an optional overrides parameter so the EditCard can pass edited text:

```tsx
// Current signature:
applyReflectionEdit: (pover: string, editIndex: number) => void;

// New signature:
applyReflectionEdit: (pover: string, editIndex: number, overrides?: {
  label?: string;
  description?: string;
}) => void;
```

In the implementation (useDebateStore.ts ~line 4326), when overrides are provided, use them instead of the edit's proposed values:

```tsx
const finalLabel = overrides?.label ?? edit.proposed_label;
const finalDescription = overrides?.description ?? edit.proposed_description;

// Then use finalLabel/finalDescription instead of edit.proposed_label/edit.proposed_description
```

The EditCard calls it as:

```tsx
onClick={() => applyReflectionEdit(pover, editIndex,
  editing && isModified ? { label: editedLabel, description: editedDescription } : undefined
)}
```

## Interaction Flow

```
Review State
  │
  ├─ [Edit] ──────► Edit State
  │                   │
  │                   ├─ type in label/description ──► "Modified" badge appears
  │                   │                                 [Reset] becomes visible
  │                   │
  │                   ├─ [Reset] ──────► fields revert to original proposal
  │                   │                  "Modified" badge hides
  │                   │
  │                   ├─ [Cancel] ─────► back to Review State (edits discarded)
  │                   │
  │                   ├─ [Approve & Apply] ► applies edited text via overrides
  │                   │
  │                   └─ [Dismiss] ────► rejects suggestion (same as before)
  │
  ├─ [Approve & Apply] ► applies proposed text unchanged (same as before)
  │
  └─ [Dismiss] ────► rejects suggestion (same as before)
```

## File Changes

| File | Change |
|------|--------|
| `taxonomy-editor/src/renderer/components/ReflectionsPanel.tsx` | Add editing state to EditCard, Edit button, textarea rendering, Reset/Cancel buttons, pass overrides on approve |
| `taxonomy-editor/src/renderer/hooks/useDebateStore.ts` | Add optional `overrides` parameter to `applyReflectionEdit` (~line 4326, 4354, 4340) |
| `taxonomy-editor/src/renderer/hooks/useDebateStore.test.ts` | Add test for `applyReflectionEdit` with overrides |

## Edge Cases

- **"Add" edit type**: No CURRENT section exists. Edit mode shows the label input + description textarea directly (no diff view to leave behind).
- **"Deprecate" edit type**: Same edit flow. The textarea pre-fills with the deprecation text. User can adjust the deprecation wording.
- **Empty fields**: Approve should be disabled if either label or description is empty/whitespace in edit mode. Use `disabled` prop on the button.
- **Long descriptions**: Textarea auto-heights with a reasonable max-height (e.g., 300px) before scrolling.
