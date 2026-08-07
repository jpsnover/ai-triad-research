# Runbook: Operational Commands (Quick Reference)

**Owner:** DevOps. Quick-reference for common one-off operational commands against the
production Container App. For the full deploy procedure see
[`production-release.md`](production-release.md); for remote health verification see the
Remote Diagnostics Cmdlets section in `operations/devops/AGENTS.md`.

**Live deployment identifiers** (source of truth: `operations/devops/AGENTS.md` "Live Deployment"):
Resource Group `ai-triad`, Container App `ai-rosetta-stone`, image
`ghcr.io/jpsnover/taxonomy-editor:latest`, region East US.

## Container App

```bash
# Redeploy latest image
az containerapp update --name ai-rosetta-stone -g ai-triad --image ghcr.io/jpsnover/taxonomy-editor:latest

# Check container status
az containerapp show --name ai-rosetta-stone -g ai-triad --query "properties.runningStatus"

# View console logs
az containerapp logs show --name ai-rosetta-stone -g ai-triad --type console
```

## Auth & Access

```bash
# Update allowed users (server-side allowlist)
az containerapp update --name ai-rosetta-stone -g ai-triad --set-env-vars "ALLOWED_USERS=user1,user2"

# Update GitHub OAuth secret
az containerapp auth github update --name ai-rosetta-stone -g ai-triad --client-secret <new-secret>
```

> **Env-var drift trap:** CLI `--set-env-vars` on the Container App is wiped by the next
> Bicep deploy. For anything durable, persist it in `deploy/azure/main.bicep` (param +
> GitHub Actions variable), not via CLI.

## Data

```bash
# Seed data from GitHub
./deploy.ps1 -ResourceGroup ai-triad -SeedData
```
