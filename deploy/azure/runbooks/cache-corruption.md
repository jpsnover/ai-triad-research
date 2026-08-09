# Runbook: Cache Corruption

**Trigger:** `alert-cache-degraded` fires (hit rate <85% over 5 min), or repeated cache misses in flight recorder

## Symptoms
- High cache miss rate in `/health` → `github.cacheHitRate`
- Slow page loads (every read hits GitHub API instead of local cache)
- Flight recorder shows repeated `cache.miss` events
- Possible: `cache.manifest.swap` with generation counter resets

## Steps

1. **Check cache state:**
   ```bash
   curl -s .../health | jq '{cacheHitRate: .github.cacheHitRate, cacheFileCount: .storage.cacheFileCount, mainSha: .storage.mainSha}'
   ```

2. **Force cache refresh via UI:**
   - Open SyncDiagnosticsDialog (gear icon in SaveBar)
   - Click "Force cache refresh"
   - This invalidates the manifest and re-fetches all files from GitHub

3. **If UI is unreachable, restart the container:**
   ```bash
   ACTIVE=$(az containerapp revision list --name taxonomy-editor -g ai-triad --query "[?properties.trafficWeight > \`0\`].name | [0]" -o tsv)
   az containerapp revision restart --name taxonomy-editor -g ai-triad --revision "$ACTIVE"
   ```
   Restarting clears `/tmp/taxonomy-cache/` and forces a full cold-start fetch.

4. **Check flight recorder for root cause:**
   - `cache.coherency_violation` → cache served stale data, auto-invalidated
   - `cache.invalidate` with trigger `force-push` → main branch was rewritten
   - `cache.manifest.swap` failures → disk I/O issue

## Prevention
- 1% coherency probe catches silent staleness
- Atomic manifest swap prevents torn reads
- Generation counter detects out-of-order updates
