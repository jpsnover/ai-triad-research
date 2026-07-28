# Remote Diagnostics Cmdlets

**Last updated:** 2026-07-28
**Author:** Diagnostics (Orca)

PowerShell cmdlets for checking production health, shared by the Diagnostics / DevOps / Azure roles (extracted from their AGENTS.md so the catalog lives once). Run `Import-Module ./scripts/AITriad/AITriad.psm1` first.

| Cmdlet | Use When |
|---|---|
| `Test-TaxEditorHealth` | Quick liveness/readiness check — first thing to run when investigating outages. Also probes the anonymous-auth layer (`/.auth/anonymous` cookie + authenticated `/api/flags` JSON), catching the case where `/healthz`+`/health` are green but every API call redirects to a login page |
| `Test-TaxEditorEndpoints` | Smoke-test 16 GET endpoints across 6 categories. Use `-Category Data` to narrow down |
| `Test-AzureHealth` | Check Azure status page, ACA liveness, TLS cert expiry. Separates app-level vs infra-level issues |
| `Test-GitHubHealth` | Check GitHub platform status, CI workflows, GHCR registry, API rate limits |
| `Invoke-TaxEditorSmokeTest` | Full end-to-end check (runs all 4 above). Use `-Detailed` for per-category tables |

All accept `-BaseUrl` to target staging or other instances. Default is the production URL.

**Triage workflow:** when a flight recorder shows errors → `Test-TaxEditorHealth` (is it still live?) → `Test-TaxEditorEndpoints -Category <relevant>` (which endpoints are failing?) → `Test-AzureHealth` or `Test-GitHubHealth` (is it infra or platform?).
