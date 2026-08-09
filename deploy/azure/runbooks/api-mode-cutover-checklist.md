# Cutover Checklist: Azure Files → GitHub API-First Mode

## Pre-Cutover (Before switching STORAGE_MODE)

- [ ] Verify `STORAGE_MODE=github-api` is set on both prod and staging container apps
- [ ] Verify GitHub App credentials work: `curl .../health` shows `github.rateLimit.remaining > 0`
- [ ] Check for unsynced changes: `curl .../api/sync/status` → `unsynced_count` should be 0
- [ ] Notify users to create PRs for any pending work
- [ ] Verify baked fallback data is fresh: check `snapshot-meta.json` generation date in container image
- [ ] Run rollback rehearsal in staging (see below)

## Rollback Rehearsal (Staging)

```bash
# 1. Switch staging to filesystem mode
az containerapp update -n taxonomy-editor-staging -g ai-triad \
  --set-env-vars STORAGE_MODE=filesystem

# 2. Verify app works in filesystem mode
curl -s https://<staging-url>/health
curl -s https://<staging-url>/api/data/available

# 3. Switch back to github-api mode
az containerapp update -n taxonomy-editor-staging -g ai-triad \
  --set-env-vars STORAGE_MODE=github-api

# 4. Verify recovery
curl -s https://<staging-url>/health
```

Document results before proceeding with production cutover.

## Cutover (Production)

- [ ] Deploy with `STORAGE_MODE=github-api` (already done as of May 13)
- [ ] Verify `/health` returns `storage.mode: "github-api"`
- [ ] Verify `/api/data/available` returns `true`
- [ ] Verify cache is warm: `/health` → `github.cacheHitRate > 0`
- [ ] Monitor for 48 hours — check health monitor workflow runs, no alerts

## Post-Cutover Soak Period (7 days)

**Soak started:** May 13, 2026
**Soak expires:** May 20, 2026

- [ ] Azure Files storage account kept alive (read-only fallback)
- [ ] Monitor daily: no health alerts, no rate limit warnings, no fallback activations
- [ ] Day 3: Verify at least one full container restart + cold start succeeded with API mode
- [ ] Day 7: Final verification — all health monitors green for 7 consecutive days

## Azure Files Deletion (After May 20)

```bash
# Verify app is healthy without Azure Files
curl -s https://taxonomy-editor.yellowbush-aeda037d.eastus.azurecontainerapps.io/health

# Delete the storage account (removes file share + all data)
az storage account delete --name staitriadkvwl3nywge4iw -g ai-triad --yes
```

**WARNING:** This is irreversible. The storage account has soft delete (7 days) but the data is 1+ GB and re-seeding takes time.

## One-Command Rollback

If issues arise at any point:

```bash
az containerapp update -n taxonomy-editor -g ai-triad \
  --set-env-vars STORAGE_MODE=filesystem
```

This switches back to filesystem mode immediately. Requires Azure Files to still be mounted (only works during soak period before deletion).
