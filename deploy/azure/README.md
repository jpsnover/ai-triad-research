# Azure Deployment — Taxonomy Editor

Deploy the Taxonomy Editor as a web app on Azure Container Apps.

## Prerequisites

- [Azure CLI](https://aka.ms/install-azure-cli) (`az`)
- An Azure subscription
- A Gemini API key
- The container image built and pushed to `ghcr.io` (happens automatically on tag push via GitHub Actions)

## Quick Start

```powershell
# 1. Log in to Azure
az login

# 2. Deploy (creates everything from scratch)
./deploy.ps1 -ResourceGroup ai-triad -GeminiApiKey (Read-Host -AsSecureString)

# 3. Seed taxonomy data from GitHub
./deploy.ps1 -ResourceGroup ai-triad -SeedData
```

The script will:
- Create a resource group (if needed)
- Deploy Container Apps + Azure Files storage via Bicep
- Set CORS to the app's URL
- Print the app URL when done

## Cost

At low usage, this runs within Azure Container Apps' **free tier**:
- 180,000 vCPU-seconds/month
- 360,000 GiB-seconds/month
- Scale to zero when idle

Storage: ~$0.06/GB/month (Standard LRS). 1 GB of taxonomy data = ~$0.06/month.

**Estimated monthly cost: $0–5**

## Architecture

```
Internet ──HTTPS──> Azure Container Apps (scale 0-1)
                        ├── Node.js server (port 7862)
                        ├── PowerShell 7 (terminal + AI commands)
                        ├── Python (embeddings)
                        └── Azure Files mount (/data)
                              └── taxonomy, debates, summaries, conflicts
```

## Adding Authentication

After deploying, add GitHub login (zero code change):

```bash
az containerapp auth update \
  --name taxonomy-editor \
  --resource-group ai-triad \
  --enabled-providers GitHub \
  --github-client-id <your-github-oauth-app-id> \
  --github-client-secret <your-github-oauth-app-secret> \
  --unauthenticated-client-action RedirectToLoginPage
```

Create a GitHub OAuth App at https://github.com/settings/applications/new with callback URL:
`https://<your-app-url>/.auth/login/github/callback`

## CI/CD

The `deploy-azure.yml` workflow deploys on manual trigger. To use it:

1. Set up Azure OIDC credentials (service principal with federated identity)
2. Add repository secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `GEMINI_API_KEY`
3. Trigger from GitHub Actions > Deploy to Azure > Run workflow

## Files

| File | Purpose |
|------|---------|
| `main.bicep` | Infrastructure as Code — all Azure resources |
| `deploy.ps1` | One-command deployment script |
| `.env.template` | Required environment variables (copy to `.env`) |
