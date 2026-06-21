# Admin Community Removal — UX Spec

**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

Allow admin users to remove published chats and debates from the community library. Currently, admins can approve/reject submissions before publishing, but have no way to remove items after they go live. This adds a removal action directly on community library cards, visible only to admins.

## Design

### Remove button on community cards (admin-only)

When an admin user views the Community Library (`CommunityLibrary.tsx`), each community item card shows a small **remove button** in the top-right corner.

```
┌────────────────────────────────┐
│                           [✕]  │  ← remove button (admin only)
│  AI Code as Technical Debt     │
│  DEBATE · Completed            │
│  Submitted by: jsnover         │
│  June 14, 2026                 │
│                                │
│  [Copy to My Library]          │
└────────────────────────────────┘
```

Non-admin users see no remove button — the card is identical to today.

### Remove button styling

- **Position:** absolute, top-right corner of the card (`top: 6px; right: 6px`)
- **Size:** `24px` circle
- **Icon:** `✕` (same as dialog close buttons elsewhere in the app)
- **Default state:** `color: var(--text-muted); background: transparent`
- **Hover:** `color: #ef4444; background: rgba(239, 68, 68, 0.1)` — red tint signals destructive action
- **Cursor:** pointer
- **Font:** `0.75rem`, centered

### Confirmation dialog

Clicking the remove button opens a small inline confirmation — not a full modal. This avoids the weight of a dialog for a quick admin action.

```
┌────────────────────────────────┐
│  Remove from community?        │
│                                │
│  "AI Code as Technical Debt"   │
│  Submitted by: jsnover         │
│                                │
│  Reason (optional):            │
│  ┌──────────────────────────┐  │
│  │                          │  │
│  └──────────────────────────┘  │
│                                │
│  Copies already made by other  │
│  users will not be affected.   │
│                                │
│  [Cancel]  [Remove]            │
└────────────────────────────────┘
```

**Implementation:** A popover/dropdown anchored to the remove button, not a separate modal. Use the same popover pattern as existing tooltips/dropdowns in the app.

**Elements:**
- **Title:** "Remove from community?" — direct, no ambiguity
- **Item identification:** Title in quotes + submitter name — so the admin confirms the right item
- **Reason field:** Optional single-line text input. Stored with the removal record for audit. Placeholder: "Reason for removal..."
- **Reassurance note:** "Copies already made by other users will not be affected." — important because `copyFromCommunity` creates independent copies
- **Buttons:** "Cancel" (secondary) and "Remove" (destructive — `background: #ef4444; color: white`)

### After removal

1. **Card disappears** with a short fade-out (`opacity 0` over `150ms`, then removed from DOM)
2. **Toast notification:** "Removed from community" — brief confirmation, same toast pattern as existing feedback/save toasts
3. **No undo** — the file is deleted. If an admin removes something by mistake, it can be re-submitted and re-approved through the normal flow.

### Mobile behavior

On phone/tablet viewports, the confirmation popover becomes a **bottom sheet** (same pattern as the feedback widget's mobile treatment from the t/561 spec). The remove button position and size remain the same on the card.

## Data flow

### New API endpoint

```
DELETE /api/community/:type/:id
```

- **Auth:** `requireAdmin(res)` — 403 for non-admins
- **Params:** `type` is `chats` or `debates`, `id` is the community item UUID
- **Body (optional):** `{ reason?: string }`
- **Action:**
  1. Load the item to capture metadata before deletion (title, submitter, dates)
  2. Delete the file: `community/{type}/{type.slice(0,-1)}-{id}.json` (e.g., `community/chats/chat-uuid.json`)
  3. Write an audit record to `community/_removals/rem-{uuid}.json` with: removed item id, type, title, submitter, removed_by (admin userId), removed_at (ISO timestamp), reason
  4. Invalidate the listing index: delete `community/{type}/_index.json` so it rebuilds on next list call
- **Response:** `{ ok: true }`
- **Error cases:**
  - Item not found → `404 { error: 'Item not found' }`
  - Not admin → `403 { error: 'Forbidden' }`

### Audit trail

Store removal records in `community/_removals/`:
```json
{
  "id": "rem-uuid",
  "item_id": "chat-uuid",
  "type": "chat",
  "title": "AI Code as Technical Debt",
  "submitted_by": "jsnover",
  "removed_by": "jpsnover",
  "removed_at": "2026-06-19T14:30:00Z",
  "reason": "Duplicate of existing community debate"
}
```

These records are write-only — no UI to browse them initially. They exist for accountability if questions arise about why an item was removed.

### Community store changes

Add to `useCommunityStore`:
```typescript
removeItem: async (type: 'chats' | 'debates', id: string, reason?: string) => {
  const res = await fetch(`/api/community/${type}/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: reason ? JSON.stringify({ reason }) : undefined,
  });
  if (!res.ok) throw new Error('Remove failed');
  // Optimistically remove from local state
  set(s => ({
    [type === 'chats' ? 'chats' : 'debates']:
      s[type === 'chats' ? 'chats' : 'debates'].filter(item => item.id !== id),
  }));
};
```

## Integration points

| File | Change |
|---|---|
| `CommunityLibrary.tsx` | Add remove button (admin-only) + confirmation popover per card |
| `useCommunityStore.ts` | Add `removeItem(type, id, reason?)` action |
| `server/community.ts` | Add `removeCommunityItem(type, id, removedBy, reason?)` function |
| `server/server.ts` | Add `DELETE /api/community/:type/:id` endpoint with admin guard |
| New: `community/_removals/` directory | Audit trail for removed items |

## What NOT to do

- No soft-delete or "hidden" state — community items are copies, the original lives in the submitter's library. Hard delete is clean and simple.
- No batch removal — admins remove one at a time. If batch becomes needed, it's a separate feature.
- No notification to the original submitter — removal is a quiet admin action. If the submitter re-submits, it goes through the normal review flow.
- No "removed items" admin view initially — the audit files exist for forensics, not for a UI. Add a view later if needed.
- No undo/restore — re-submit through the normal flow instead.

## Accessibility

- Remove button: `aria-label="Remove {title} from community"`
- Confirmation popover: focus traps to Cancel/Remove buttons
- Remove button has `role="button"` (already implicit on `<button>`)
- Cancel is keyboard-focusable and responds to Escape
- Toast uses `role="status"` for screen reader announcement
