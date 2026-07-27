# Sync — File Inventory

Reference inventory for the Sync role's scope (`taxonomy-editor/src/renderer/components/sync/`). Behavioral norms and conventions live in [AGENTS.md](./AGENTS.md).

| File | Purpose |
|------|---------|
| `SaveBar.tsx` | Save/commit bar for local changes; surfaces sync status (unsynced/upstream/conflict) and opens the diff panel / drawer |
| `UnsyncedChangesDrawer.tsx` | Drawer listing pending unsynced files with per-file diff, plus Create-PR / Resync / Discard actions |
| `TaxonomyDiffPanel.tsx` | Node-level semantic diff (added/modified/removed, field-level) + pre-submission PR review/submit |
| `TaxonomyUpdateToast.tsx` | Real-time "another editor saved" toast (consumes the `taxonomy-updated` WebSocket event) |
| `GitProgressBanner.tsx` | Progress indicator for git operations |
| `RebaseConflictModal.tsx` | Modal for resolving rebase conflicts |
| `SyncDiagnosticsDialog.tsx` | Diagnostics for sync issues |
| `index.ts` | Barrel re-exports |

Co-located `*.css` files (e.g. `TaxonomyDiffPanel.css`, `TaxonomyUpdateToast.css`) style their same-named components.
