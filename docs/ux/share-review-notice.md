# Share-to-Community Review Notice — UX Spec

**Author:** Design (Orca)
**Status:** Ready for implementation

## Overview

When a user shares a chat or debate to the community, they currently see a terse confirmation like "Submitted (abc12345)" or "Shared! (abc12345)". There is no indication that the item must be reviewed and approved before it appears in the community library. This creates a confusing experience when users share something and then can't find it in the community.

This spec adds clear messaging at two points: the moment of sharing and in a "My Submissions" view where users can track status.

## Design

### 1. Post-share confirmation message

Replace the current terse success messages with a clear notice that includes the review expectation.

#### Debate share (DebateWorkspace.tsx)

**Current:** `Submitted (abc12345)` — green text inline next to the Share button

**New:** Replace the inline status text with a small confirmation banner below the share button area:

```
┌─────────────────────────────────────────────────┐
│  ✓ Submitted for review                         │
│  Your debate will appear in the community        │
│  library once it has been reviewed and approved.  │
│                                          [OK]    │
└─────────────────────────────────────────────────┘
```

**Implementation:** A small dismissible banner that appears below the Share button after a successful submit. Not a modal — it's inline and non-blocking.

- **Background:** `var(--bg-secondary)` with a left border `3px solid var(--green, #22c55e)`
- **Icon:** `✓` in green
- **Heading:** "Submitted for review" — `font-weight: 600, font-size: 0.78rem`
- **Body:** "Your debate will appear in the community library once it has been reviewed and approved." — `font-size: 0.75rem, color: var(--text-secondary)`
- **Dismiss:** Small "OK" text button, right-aligned. Also auto-dismisses after 8 seconds.
- **Spacing:** `margin-top: 6px`, `padding: 8px 12px`, `border-radius: 6px`

#### Chat share (ChatWorkspace.tsx)

**Current:** `Shared! (abc12345)` — inline text that fades after 4 seconds

**New:** Same banner pattern as the debate share, appearing below the chat header bar:

```
┌────────────────────────────────────────────────────────┐
│ ✓ Submitted for review — your chat will appear in the  │
│   community library once reviewed and approved.  [OK]  │
└────────────────────────────────────────────────────────┘
```

For the chat, use a **single-line compact variant** since the chat header area is narrower:
- Same styling but body text on one line with heading
- Format: "Submitted for review — your chat will appear in the community library once reviewed and approved."
- Auto-dismisses after 8 seconds

### 2. Admin auto-approve: different message

Admin submissions are auto-approved (line 227-230 in `community.ts`). When the server returns a `communityId` (indicating immediate publish), show a different message:

```
✓ Shared to community
```

One line, green text, same as existing — no "review" language since it's already live. This only applies when the server response includes a `communityId` field (auto-approved).

**Detection:** The `submitToCommunity` response already returns `{ submissionId }` for pending items. For auto-approved admin submissions, the response also includes `{ submissionId, communityId }`. Check for the presence of `communityId` to determine which message to show.

### 3. Share button tooltip update

Update the Share button's `title` attribute to set expectations before the user clicks:

**Current (Debate):** "Submit this debate to the Community Library"
**New:** "Submit this debate for community review"

**Current (Chat):** (no title)
**New:** "Submit this chat for community review"

### 4. Error state (unchanged)

Failed shares continue to show the existing red error text. No change needed.

## What NOT to do

- No "My Submissions" tracking view in this spec — that's a separate feature if needed later
- No email/notification when submissions are approved — out of scope
- No pre-share confirmation dialog — the share button is intentional enough; adding a "are you sure?" step would slow down a common action
- No animation beyond the auto-dismiss — keep it simple

## Integration points

| File | Change |
|---|---|
| `debate-workspace/DebateWorkspace.tsx` `ShareToCommunityButton` | Replace inline success text with dismissible review banner; update tooltip |
| `chat/ChatWorkspace.tsx` | Replace `setShareStatus('Shared!')` with review banner; add tooltip to Share button |
| `useCommunityStore.ts` `submitItem` | Return full server response (check for `communityId` to detect auto-approve) |

## Accessibility

- Banner uses `role="status"` for screen reader announcement
- "OK" dismiss button is keyboard-focusable
- Auto-dismiss uses a timeout — keyboard/screen reader users can dismiss manually before timeout
