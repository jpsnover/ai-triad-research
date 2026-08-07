# Troubleshooting

Known issues and their workarounds.

## Git credential helper error during push

**Error:**
```
Error: Cannot find module '.../git-credential-helper.js'
```

**Context:** This appears in Orca agent terminals during `git push`. The error comes from Orca's git credential helper path referencing a file that doesn't exist in the app bundle.

**Impact:** Cosmetic only — the push completes successfully despite the error.

**Action:** None required. The error can be safely ignored.

## Windows: debate saves fail or produce corrupt JSON (EPERM on rename)

**Error (flight recorder):**
```
io.retry: renameSyncWithRetry failed (EPERM), retry N/7 after Nms
```
followed by a subsequent `SyntaxError` loading the debate session.

**Context:** Windows Defender and Windows Search Indexer briefly hold exclusive handles on files in actively-scanned directories. When a file rename is denied long enough to exhaust the retry budget, the atomic-write fallback triggers. In rare cases the target file ends up corrupt.

**Root cause:** Windows AV/indexer scanning `ai-triad-data\debates\` during a save.

**Fix (dev machines):** Exclude the debates directory from real-time scanning:

*Windows Defender:*
1. Open **Windows Security → Virus & threat protection → Manage settings**
2. Under **Exclusions**, click **Add or remove exclusions → Add an exclusion → Folder**
3. Add the path to your `ai-triad-data\debates\` directory

*Windows Search Indexer:*
1. Open **Control Panel → Indexing Options → Modify**
2. Remove (exclude) your `ai-triad-data\` directory from the indexed locations

**Impact without fix:** Debate saves may fail with an `ActionableError` naming a `.tmp` recovery artifact. The `.tmp` file holds the complete unsaved content — rename it to `<debate-id>.json` to recover the session.
