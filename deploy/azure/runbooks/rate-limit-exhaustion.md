# Runbook: Rate Limit Exhaustion

**Trigger:** `alert-github-rate-limit-critical` fires (remaining <500 or 429 received)

## Symptoms
- `/health` returns `github.rateLimit.remaining` near 0
- Structured logs show `github.api.rate_limit` events with `degraded` status
- App enters degraded mode: polling disabled, serving from cache only
- Writes may fail with "GitHub API rate limit exceeded"

## Steps

1. **Check current rate limit:**
   ```bash
   curl -s .../health | jq .github.rateLimit
   ```
2. **Identify consumption source:** Query Log Analytics:
   ```kusto
   ContainerAppConsoleLogs_CL
   | where Log_s contains "github.api.request"
   | summarize count() by bin(TimeGenerated, 1m)
   | order by TimeGenerated desc
   ```
3. **If burst from container scaling:** Check replica count — multiple instances share the rate limit
   ```bash
   az containerapp revision list --name taxonomy-editor -g ai-triad --query "[?properties.active].{name:name, replicas:properties.replicas}" -o table
   ```
4. **Immediate mitigation:** Scale to 0 temporarily to stop polling storm:
   ```bash
   az containerapp update --name taxonomy-editor -g ai-triad --min-replicas 0 --max-replicas 0
   ```
5. **Wait for reset:** Rate limit resets hourly. Check `github.rateLimit.resetsAt` on `/health`.
6. **Restore:** Scale back up:
   ```bash
   az containerapp update --name taxonomy-editor -g ai-triad --min-replicas 1 --max-replicas 5
   ```

## Prevention
- Keep `maxReplicas: 1` for low-traffic apps (prevents rate limit multiplication)
- Degraded mode at 500 remaining auto-disables polling
- Monitor `X-RateLimit-Remaining` in structured logs
