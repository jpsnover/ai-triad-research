# Runbook: GitHub Outage

**Trigger:** `alert-fallback-active` fires (fallback data served for >5 min)

## Symptoms
- `/health` returns `storage.fallbackActive: true`
- Users see banner: "Running in offline mode — data from [build date]. Edits disabled."
- Flight recorder shows `storage.fallback` events

## Steps

1. **Verify GitHub status:** Check https://www.githubstatus.com/
2. **Confirm fallback is serving:** `curl .../health | jq .storage.fallbackActive`
3. **Check fallback data age:** `curl .../health | jq .storage` — note the `snapshot-meta.json` generation date
4. **No action needed** — writes auto-resume when GitHub API returns. The circuit breaker probes every 30s→5m (exponential backoff) and auto-recovers.
5. **If prolonged (>1 hour):** Notify users via the app banner (automatic). Consider whether stale data is acceptable for their work.
6. **After recovery:** Check flight recorder for `github.api.response` events resuming. Cache auto-refreshes.

## Prevention
- Container image builds run daily to keep baked snapshot fresh
- Circuit breaker with adaptive half-open probing ensures fast recovery
