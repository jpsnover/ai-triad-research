# Conflict — File Inventory

Reference inventory for the conflict detection/resolution UI. Behavioral norms and conventions live in `AGENTS.md`.

| File | Purpose |
|------|---------|
| `ConflictsTab.tsx` | Tab listing all detected conflicts |
| `ConflictDetail.tsx` | Detailed view of a single conflict |
| `ConflictInstanceForm.tsx` | Form for recording a conflict instance |
| `ConflictNoteForm.tsx` | Form for adding notes to conflicts |
| `edit-conflicts/` | Per-node git edit-conflict detection (Phase 5D): `useNodeConflicts` hook + `EditConflictBadge`, consuming `/api/sync/node-conflicts`. Distinct from the research-domain conflict UI above. |
| `index.ts` | Barrel re-exports |
