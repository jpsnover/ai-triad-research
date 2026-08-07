# Deployment Facts — Canonical Source of Truth

**Owner:** DevOps. **Last verified:** 2026-07-27 against Azure via `az containerapp list` / `az containerapp env list` (see [Re-verify](#re-verify)).

This is the single source of truth for the deployment's identity facts. The DevOps, Azure, and Docker `AGENTS.md` files **link here — they must not restate these values inline** (inline copies drift out of sync; that drift was the t/1735 bug).

## Production

| Fact | Value |
|---|---|
| Container App | `ai-rosetta-stone` |
| Resource Group | `ai-triad` |
| Region | East US |
| ACA Environment | `cae-aitriad` (Consumption plan) |
| App URL | https://ai-rosetta-stone.yellowbush-aeda037d.eastus.azurecontainerapps.io |
| Env domain suffix | `yellowbush-aeda037d.eastus.azurecontainerapps.io` |
| Container Image | `ghcr.io/jpsnover/taxonomy-editor:latest` — **GHCR, not Azure Container Registry** |
| Storage Account / File Share | `staitriadkvwl3nywge4iw` / `taxonomy-data` |
| Scale | 0–1 replicas, 1.0 CPU / 2 GiB RAM (scale-to-zero) |
| Auth | GitHub + Google OAuth via Azure Easy Auth |
| API keys | BYOK — users supply keys via the app UI (client-side); none in infra (ADR-002) |
| Cost target | $0–5/month |

## Staging

| Fact | Value |
|---|---|
| Container App | `ai-rosetta-stone-staging` |
| Resource Group | `ai-triad` |
| Region | East US |
| App URL | https://ai-rosetta-stone-staging.yellowbush-aeda037d.eastus.azurecontainerapps.io |

## Re-verify

```
az containerapp list --query "[].{name:name, rg:resourceGroup, location:location, fqdn:properties.configuration.ingress.fqdn}" -o table
az containerapp env list --query "[].{name:name, rg:resourceGroup, location:location, defaultDomain:properties.defaultDomain}" -o table
```

Whenever the deployment identity changes, update **this file** — not the AGENTS.md files (which only link here). Related: [operational-commands.md](operational-commands.md), [production-release.md](production-release.md).

## Drift corrected (t/1735, 2026-07-27)

The Azure `AGENTS.md` "Current Deployment" block had drifted on four facts; corrected here against live Azure:

| Fact | Stale (wrong) | Actual |
|---|---|---|
| App name | `ai-triad-taxonomy-editor` | `taxonomy-editor` |
| Region | East US 2 | East US |
| ACA Environment | `ai-triad-prod` | `cae-aitriad` |
| Registry | Azure Container Registry (Basic) | GHCR (`ghcr.io/jpsnover/taxonomy-editor`) |

The DevOps `AGENTS.md` "Live Deployment" block was already correct and matched Azure.
