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
