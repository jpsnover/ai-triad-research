// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ═══════════════════════════════════════════════════════════════════════════════
// Azure Container Apps deployment for Taxonomy Editor
//
// BYOK (Bring Your Own Key) model: API keys are NOT passed at deployment time.
// Users enter their own Gemini/Claude/Groq API keys through the app UI.
// Keys stored in Azure Key Vault via managed identity.
//
// Data access: GitHub API-first — reads/writes go to jpsnover/ai-triad-data
// via GitHub Contents/Trees APIs. No Azure Files, no local git clone.
//
// Resources created:
//   - Container Apps Environment (serverless)
//   - Container App (the Taxonomy Editor, system-assigned managed identity)
//   - Log Analytics Workspace (diagnostics)
//   - Key Vault (per-user BYOK secrets + GitHub App PEM, accessed via managed identity)
//   - Storage Account (Azure Blob — per-user content + community library)
//
// Usage:
//   az deployment group create -g ai-triad -f main.bicep
// ═══════════════════════════════════════════════════════════════════════════════

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Container image (ghcr.io/jpsnover/taxonomy-editor:latest)')
param containerImage string = 'ghcr.io/jpsnover/taxonomy-editor:latest'

@description('Unique suffix for globally unique resource names')
param uniqueSuffix string = uniqueString(resourceGroup().id)

// ── Traffic pin (t/2049 — pre-traffic canary/health gate) ──
// In activeRevisionsMode 'Multiple' with NO ingress.traffic block, a full Bicep
// apply reconciles traffic and promotes the LATEST revision to 100% — before the
// deploy workflow's readiness gate ever runs (the t/2047 bypass). Worse: this
// template defines BOTH the prod and staging apps, so EVERY apply reconciles
// BOTH — a staging-intent deploy would silently wipe a manual prod rollback pin
// and re-promote prod's latest (t/2049#6 landmine). To close this, each app's
// ingress pins 100% traffic to an explicit, already-live revision. The deploy
// workflow and deploy.ps1 capture each app's CURRENT ACTIVE revision and pass it
// here, so a newly-created revision starts at 0% and is promoted only after
// /healthz readiness + acceptance + persona gates pass. Empty = genuine
// first/only deploy -> latest gets 100% (safe; there is nothing to hold).
// NEVER pass empty as a silent fallback when the capture step FAILED — the
// capture must abort instead (t/2049#6).
@description('Full name of the revision to hold 100% PROD ingress traffic on during a Bicep apply (e.g. "taxonomy-editor--restore-gem"). Empty = first/only deploy (latest gets 100%).')
param trafficPinRevisionName string = ''

@description('Full name of the revision to hold 100% STAGING ingress traffic on during a Bicep apply. Empty = first/only staging deploy (latest gets 100%).')
param trafficPinRevisionNameStaging string = ''

// ── Resource Tags ──
var tags = {
  project: 'ai-triad-research'
  environment: 'production'
  'managed-by': 'bicep'
}

// ── OAuth identity providers ──
// Bicep owns the container app's secret store. Pass the client secrets as
// secure params at deploy time (the workflow reads them from GH Actions
// secrets). If a param is empty, the corresponding provider self-disables
// below and its secret is omitted.

@description('Google OAuth 2.0 client ID (from https://console.cloud.google.com)')
param googleClientId string = ''

@description('GitHub OAuth app client ID (from https://github.com/settings/developers)')
param githubClientId string = ''

@secure()
@description('Google OAuth 2.0 client secret')
param googleClientSecret string = ''

@secure()
@description('GitHub OAuth app client secret')
param githubClientSecret string = ''

@description('Azure AD (Microsoft Entra ID) app client ID')
param aadClientId string = ''

@secure()
@description('Azure AD app client secret')
param aadClientSecret string = ''

@description('Azure AD OpenID issuer — use "common" for multi-tenant + personal accounts, or a specific tenant ID')
param aadIssuer string = 'common'

@description('Auth mode: set authDisabled="1" for anonymous-only (no login page), or authOptional="1" for login page with anonymous option. If neither, sign-in is required (needs authorized-users.json).')
param authDisabled string = ''

@description('Set to "1" to show login page with sign-in + anonymous options. Signed-in users get full access (AI + editing); anonymous users get read-only, non-AI access.')
param authOptional string = '1'

@description('Comma-separated list of admin userIds (derived storage IDs, not raw emails — see deriveStorageUserId in userContext.ts). Grants the community/calibration review UI and /api/admin/* endpoints. Sourced from the ADMIN_USERS GitHub Actions variable so personal emails stay out of public source. Defaults to jpsnover (matches the server default).')
param adminUsers string = 'jpsnover,jsnover13-at-gmail-com'

// ── GitHub data-sync (optional Phase-2 feature) ──
// When enabled, web edits commit to a per-user branch in the working tree and
// the user can open / update a pull request against origin/main from the UI.
// Set GIT_SYNC_ENABLED to '1' to turn the feature on at runtime. Authenticate
// either with a GitHub App (preferred) or a PAT fallback (dev/test only).
// The App's private key is NOT passed through Bicep — upload it to Key Vault
// once (`az keyvault secret set --name github-app-private-key --file key.pem`)
// and pass the secret NAME here.

@description('Enable GitHub data-sync feature. "1" = on, empty = off.')
param gitSyncEnabled string = ''

@description('GitHub repo in owner/repo form (e.g. "jpsnover/ai-triad-data") that the server pushes to.')
param githubRepo string = ''

@description('GitHub App numeric ID. Leave empty to fall back to GITHUB_TOKEN (PAT).')
param githubAppId string = ''

@description('GitHub App installation ID on the target repo/org.')
param githubAppInstallationId string = ''

@description('Name of the Key Vault secret holding the GitHub App private key (PEM). Upload separately via az keyvault secret set.')
param githubAppPrivateKeySecretName string = ''

@secure()
@description('Optional GITHUB_TOKEN (PAT) fallback when no App is registered. Prefer the App for production.')
param githubToken string = ''

@secure()
@description('HMAC shared secret for the Phase-3 GitHub webhook. When set, /api/sync/webhook/github verifies X-Hub-Signature-256 and flags upstream-updated.')
param githubWebhookSecret string = ''

@secure()
@description('Gemini API key for the anonymous free tier. When set, keyless web users get limited Gemini access (pinned model, rate-limited). Omit to keep the free tier disabled.')
param freeTierGeminiKey string = ''

@secure()
@description('Paid Gemini API key for fallback when user has no key and free tier is exhausted. Omit to disable paid fallback.')
param geminiPaidKey string = ''

// ── Ephemeral self-hosted runner (ACI + Azure Function) ──
@description('Enable ephemeral GitHub Actions runner infrastructure (Azure Function + ACI)')
param ephemeralRunnerEnabled bool = false

@secure()
@description('GitHub PAT with repo + admin:org scope for runner registration tokens')
param githubRunnerPat string = ''

@secure()
@description('HMAC secret for verifying GitHub runner webhook signatures')
param githubRunnerWebhookSecret string = ''

var googleEnabled = !empty(googleClientId) && !empty(googleClientSecret)
var githubEnabled = !empty(githubClientId) && !empty(githubClientSecret)
var aadEnabled = !empty(aadClientId) && !empty(aadClientSecret)
var googleClientSecretName = 'google-client-secret'
var githubClientSecretName = 'github-client-secret'
var aadClientSecretName = 'aad-client-secret'
var githubTokenSecretName = 'github-sync-token'
var githubWebhookSecretName = 'github-webhook-secret'
var githubTokenProvided = !empty(githubToken)
var githubWebhookSecretProvided = !empty(githubWebhookSecret)
var freeTierEnabled = !empty(freeTierGeminiKey)
var freeTierSecretName = 'free-tier-gemini-key'
var paidTierEnabled = !empty(geminiPaidKey)
var paidTierSecretName = 'gemini-paid-key'
var oauthSecrets = concat(
  googleEnabled ? [ { name: googleClientSecretName, value: googleClientSecret } ] : [],
  githubEnabled ? [ { name: githubClientSecretName, value: githubClientSecret } ] : [],
  aadEnabled ? [ { name: aadClientSecretName, value: aadClientSecret } ] : [],
  githubTokenProvided ? [ { name: githubTokenSecretName, value: githubToken } ] : [],
  githubWebhookSecretProvided ? [ { name: githubWebhookSecretName, value: githubWebhookSecret } ] : [],
  freeTierEnabled ? [ { name: freeTierSecretName, value: freeTierGeminiKey } ] : [],
  paidTierEnabled ? [ { name: paidTierSecretName, value: geminiPaidKey } ] : []
)

// ── Log Analytics ──

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-aitriad-${uniqueSuffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
  }
}

// ── Key Vault (per-user BYOK secrets) ──
// Uses RBAC authorization; the container app's system-assigned managed
// identity is granted 'Key Vault Secrets Officer' on this vault below.
// Secret names: apikey-<backend>-<sha256(principal)[:32]>

resource keyVault 'Microsoft.KeyVault/vaults@2026-02-01' = {
  name: 'kv-ait-${uniqueSuffix}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      // Allow required for consumption-tier ACA — managed identity calls
      // use unpredictable Azure SNAT IPs that can't be allowlisted, and
      // ACA is not a Key Vault "trusted service" for bypass purposes.
      // Still protected by RBAC (only the container app's MSI has access).
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// ── Key Vault Diagnostics ──
// Sends audit events (secret reads, writes, deletes) to Log Analytics.

resource kvDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: keyVault
  name: 'kv-audit-logs'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      {
        categoryGroup: 'audit'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
        retentionPolicy: {
          enabled: false
          days: 0
        }
      }
    ]
  }
}

// ── Application Insights (error monitoring) ──
// Free tier: 5 GB/month ingestion. Connected to the same Log Analytics workspace.
// The connection string is injected as APPLICATIONINSIGHTS_CONNECTION_STRING env var.
// The taxonomy-editor server uses the @azure/monitor-opentelemetry SDK to send
// exceptions, request traces, and custom events.

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-aitriad-${uniqueSuffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    RetentionInDays: 90
  }
}

// ── Container Apps Environment ──

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-aitriad'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ── Azure Blob Storage (user content + community library) ──
// User-generated content (chats, debates, settings) and the community library
// live in Blob Storage instead of the GitHub repo. Auth via managed identity
// (DefaultAzureCredential) — no connection strings or SAS tokens.

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'staitriad${uniqueSuffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // allowSharedKeyAccess left enabled — Azure Files mount (taxonomy-data)
    // uses account key via managed environment storage; disabling breaks the mount.
    // Migrate environment storage to identity-based auth before enabling.
    networkAcls: {
      // Allow required for consumption-tier ACA — SMB/CIFS mounts use Azure
      // SNAT outbound IPs which are unpredictable and can't be allowlisted.
      // VNet integration + private endpoints would allow Deny but exceed
      // the $0-5/month cost target. Still protected by shared-key auth.
      defaultAction: 'Allow'
      bypass: 'AzureServices, Logging, Metrics'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource userContentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'user-content'
  properties: {
    publicAccess: 'None'
  }
}

resource communityContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'community'
  properties: {
    publicAccess: 'None'
  }
}

resource analyticsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'analytics'
  properties: {
    publicAccess: 'None'
  }
}

// ── Staging-isolated blob containers (H5) ──
// Staging writes to its own containers to prevent cross-contamination with
// production user data. The staging Container App env needs updating to
// use these container names (BLOB_CONTAINER_PREFIX=staging-).

resource stagingUserContentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'staging-user-content'
  properties: {
    publicAccess: 'None'
  }
}

resource stagingCommunityContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'staging-community'
  properties: {
    publicAccess: 'None'
  }
}

resource stagingAnalyticsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'staging-analytics'
  properties: {
    publicAccess: 'None'
  }
}

// ── Container App ──

var baseEnv = [
  { name: 'AI_TRIAD_DATA_ROOT', value: '/tmp/taxonomy-cache' }
  { name: 'ALLOWED_ORIGINS', value: 'https://taxonomy-editor.${containerAppEnv.properties.defaultDomain}' }
  { name: 'HOME', value: '/home/aitriad' }
  { name: 'NODE_ENV', value: 'production' }
  // BYOK model: users enter keys via the app UI. In Azure the server
  // routes them to Key Vault (one secret per user+backend), accessed
  // via the container app's system-assigned managed identity.
  { name: 'AZURE_KEYVAULT_URL', value: keyVault.properties.vaultUri }
  // Auth mode: AUTH_OPTIONAL='1' shows login page with sign-in + anonymous
  // option. AUTH_DISABLED='1' skips auth entirely. Neither = required sign-in.
  { name: 'AUTH_DISABLED', value: authDisabled }
  { name: 'AUTH_OPTIONAL', value: authOptional }
  // Admin allowlist — comma-separated derived userIds gating the review UI and
  // /api/admin/* endpoints. Declared here so it survives Bicep deploys (a CLI
  // --set-env-vars value would be wiped by the next full template deployment).
  { name: 'ADMIN_USERS', value: adminUsers }
  // Tell the server to trust Easy Auth headers (X-MS-CLIENT-PRINCIPAL-*).
  // Container Apps should auto-inject this but doesn't reliably do so.
  { name: 'WEBSITE_AUTH_ENABLED', value: 'true' }
  // GitHub sync (Phase-2). GIT_SYNC_ENABLED is the master switch;
  // githubAppAuth.ts tries App credentials first, then GITHUB_TOKEN.
  // The App private key itself lives in Key Vault and is fetched by
  // name via the managed identity; it is never injected as an env.
  { name: 'GIT_SYNC_ENABLED', value: gitSyncEnabled }
  { name: 'GITHUB_REPO', value: githubRepo }
  { name: 'GITHUB_APP_ID', value: githubAppId }
  { name: 'GITHUB_APP_INSTALLATION_ID', value: githubAppInstallationId }
  { name: 'GITHUB_APP_PRIVATE_KEY_SECRET_NAME', value: githubAppPrivateKeySecretName }
  // Application Insights — runtime error monitoring and request tracing.
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
  // Azure Blob Storage — user content (chats, debates) and community library.
  // Auth via managed identity (DefaultAzureCredential), no connection string needed.
  { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageAccount.properties.primaryEndpoints.blob }
]
var envWithToken = githubTokenProvided
  ? concat(baseEnv, [ { name: 'GITHUB_TOKEN', secretRef: githubTokenSecretName } ])
  : baseEnv
var envWithWebhook = githubWebhookSecretProvided
  ? concat(envWithToken, [ { name: 'GITHUB_WEBHOOK_SECRET', secretRef: githubWebhookSecretName } ])
  : envWithToken
var envWithFreeTier = freeTierEnabled
  ? concat(envWithWebhook, [ { name: 'FREE_TIER_GEMINI_KEY', secretRef: freeTierSecretName } ])
  : envWithWebhook
var containerEnv = paidTierEnabled
  ? concat(envWithFreeTier, [ { name: 'GEMINI_PAID_KEY', secretRef: paidTierSecretName } ])
  : envWithFreeTier

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ai-rosetta-stone'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      // t/2050: retain recent inactive revisions so a rollback / forensic target
      // survives ACA garbage collection. The t/2047 outage's auto-rollback was a
      // no-op because the prior good revision had been GC'd. 10 keeps roughly a
      // sprint of history at negligible cost (inactive revisions run no replicas).
      maxInactiveRevisions: 10
      ingress: {
        external: true
        targetPort: 7862
        transport: 'auto' // supports both HTTP and WebSocket
        allowInsecure: false
        // t/2049: hold 100% traffic on an explicit, already-live revision so this
        // apply never auto-promotes a new one (see the trafficPinRevisionName
        // param header). Empty pin -> latest@100 (first/only deploy).
        traffic: empty(trafficPinRevisionName)
          ? [ { latestRevision: true, weight: 100 } ]
          : [ { revisionName: trafficPinRevisionName, weight: 100 } ]
      }
      secrets: oauthSecrets
    }
    template: {
      containers: [
        {
          name: 'ai-rosetta-stone'
          image: containerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: containerEnv
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/healthz', port: 7862 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: { path: '/healthz', port: 7862 }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 7862 }
              periodSeconds: 10
              failureThreshold: 30
            }
          ]
          volumeMounts: [
            // Shared persistent Azure Files mount — survives revision/replica
            // restarts and is visible to ALL replicas (not an ephemeral
            // per-replica emptyDir). Backs replica-independent anonymous
            // session storage (t/683); the server writes session files under
            // <mountPath>/anon-sessions/.
            {
              volumeName: 'shared-data'
              mountPath: '/mnt/shared'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'shared-data'
          storageType: 'AzureFile'
          // References the managed-environment storage 'taxonomy-data'
          // (Azure Files share on staitriadkvwl3nywge4iw, accessMode ReadWrite).
          storageName: 'taxonomy-data'
        }
      ]
      scale: {
        // Scale-out restored after t/683 (ed489b9): AnonymousSessionStore is now
        // file-backed on the shared /mnt/shared volume, so debate state is
        // replica-independent — the single-replica stopgap is no longer needed.
        // minReplicas reverted 1->0 (t/1354, 2026-07-07): prod was costing
        // ~$24 in its first 6 days of July alone (~$120+/mo projected) from
        // running 1 vCPU/2GiB continuously. Owner accepted the cold-start
        // latency tradeoff this reintroduces (previously fixed for the same
        // reason in e247ef75, 2026-05-05) in exchange for scale-to-zero savings.
        minReplicas: 0
        maxReplicas: 5
        rules: [
          {
            name: 'http-scaler'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
      }
      terminationGracePeriodSeconds: 60
    }
  }
}

// ── Staging Container App ──
// Separate app for staging deploys — shares the environment and storage but
// runs independently so a bad staging deploy cannot affect production.

resource containerAppStaging 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ai-rosetta-stone-staging'
  location: location
  tags: union(tags, { environment: 'staging' })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      activeRevisionsMode: 'Multiple'
      // t/2050: retain recent inactive revisions (see prod app comment).
      maxInactiveRevisions: 10
      ingress: {
        external: true
        targetPort: 7862
        transport: 'auto'
        allowInsecure: false
        // t/2049: hold 100% staging traffic on an explicit live revision so a
        // Bicep apply never auto-promotes a new one. Empty -> latest@100.
        traffic: empty(trafficPinRevisionNameStaging)
          ? [ { latestRevision: true, weight: 100 } ]
          : [ { revisionName: trafficPinRevisionNameStaging, weight: 100 } ]
      }
      secrets: oauthSecrets
    }
    template: {
      containers: [
        {
          name: 'ai-rosetta-stone'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: containerEnv
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 7862 }
              periodSeconds: 5
              failureThreshold: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

// ── Role assignment: container app → Key Vault ──
// Grants 'Key Vault Secrets Officer' (get/set/delete secrets) to the
// container app's system-assigned managed identity on this vault only.

var kvSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, containerApp.id, kvSecretsOfficerRoleId)
  properties: {
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficerRoleId)
  }
}

// Staging gets read-only Key Vault access (Secrets User, not Officer)
// to prevent staging from modifying production user secrets (H5).
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource kvRoleAssignmentStaging 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, containerAppStaging.id, kvSecretsUserRoleId)
  properties: {
    principalId: containerAppStaging.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

// ── Role assignment: container apps → Blob Storage ──
// Grants 'Storage Blob Data Contributor' (read/write/delete blobs) to both
// prod and staging container apps via their system-assigned managed identities.

var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource blobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storageAccount
  name: guid(storageAccount.id, containerApp.id, blobDataContributorRoleId)
  properties: {
    principalId: containerApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

// Staging blob access scoped to staging-specific containers only (H5).
// Prevents staging from reading/writing production user data.
resource blobRoleAssignmentStagingUserContent 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: stagingUserContentContainer
  name: guid(stagingUserContentContainer.id, containerAppStaging.id, blobDataContributorRoleId)
  properties: {
    principalId: containerAppStaging.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

resource blobRoleAssignmentStagingCommunity 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: stagingCommunityContainer
  name: guid(stagingCommunityContainer.id, containerAppStaging.id, blobDataContributorRoleId)
  properties: {
    principalId: containerAppStaging.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

// ── Authentication (Easy Auth for Container Apps) ──
// Enables /.auth/login/<provider> endpoints. On successful OAuth, Azure injects
// X-MS-CLIENT-PRINCIPAL-* headers into requests to the container. The server
// (src/server/server.ts) reads those headers and gates access via
// authorized-users.json.
//
// unauthenticatedClientAction: 'AllowAnonymous' — we don't auto-redirect because
// the server renders its own login picker (multi-provider), then the picker
// buttons link to /.auth/login/google or /.auth/login/github.

resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-10-02-preview' = {
  parent: containerApp
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    identityProviders: {
      google: {
        enabled: googleEnabled
        registration: {
          clientId: googleClientId
          clientSecretSettingName: googleClientSecretName
        }
        validation: {
          allowedAudiences: []
        }
      }
      gitHub: {
        enabled: githubEnabled
        registration: {
          clientId: githubClientId
          clientSecretSettingName: githubClientSecretName
        }
      }
      azureActiveDirectory: {
        enabled: aadEnabled
        registration: {
          clientId: aadClientId
          clientSecretSettingName: aadClientSecretName
          #disable-next-line no-hardcoded-env-urls
          openIdIssuer: 'https://login.microsoftonline.com/${aadIssuer}/v2.0'
        }
      }
    }
    login: {
      routes: {
        logoutEndpoint: '/.auth/logout'
      }
      allowedExternalRedirectUrls: [
        'https://${containerApp.properties.configuration.ingress.fqdn}'
      ]
      preserveUrlFragmentsForLogins: false
      tokenStore: {
        enabled: true
      }
    }
  }
}

// ── Budget Alert ──
// Alerts at 80% and 100% of $5/month to catch cost overruns early.

@description('Email address for budget alerts')
param budgetAlertEmail string = ''

@description('First day of the current month at deploy time — Azure Consumption budgets reject a monthly startDate prior to the current month')
param budgetStartDate string = utcNow('yyyy-MM-01')

var budgetAlertConfigured = !empty(budgetAlertEmail)

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (budgetAlertConfigured) {
  name: 'budget-aitriad-monthly'
  properties: {
    category: 'Cost'
    amount: 5
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      warning80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        contactEmails: [ budgetAlertEmail ]
      }
      limit100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        contactEmails: [ budgetAlertEmail ]
      }
    }
  }
}

// ── Container Restart Loop Alert ──
// Fires when a revision has 5+ restart events in 10 minutes.
// Uses the Log Analytics workspace connected to the Container Apps Environment.

resource restartAlertActionGroup 'Microsoft.Insights/actionGroups@2023-09-01-preview' = if (budgetAlertConfigured) {
  name: 'ag-aitriad-restart-alert'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'RestartLoop'
    enabled: true
    emailReceivers: budgetAlertConfigured ? [
      { name: 'owner', emailAddress: budgetAlertEmail, useCommonAlertSchema: true }
    ] : []
  }
}

resource restartLoopAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-restart-loop'
  location: location
  tags: tags
  properties: {
    displayName: 'Container Restart Loop Detected'
    description: 'Fires when a container revision restarts 5+ times in 10 minutes — likely a crash loop from a bad deploy.'
    severity: 1
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppSystemLogs_CL
            | where Reason_s in ("ContainerBackOff", "StoppingContainer", "ImagePullBackOff")
            | summarize RestartCount = count() by RevisionName_s
            | where RestartCount > 5
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

// ── Image Pull Failure Alert ──
// Fires on any ImagePullBackOff event — severity 0 (critical) because this is
// a hard-down scenario (no app container starts). Added after the 2026-07-05
// outage where an expired GHCR PAT caused ImagePullBackOff on replica recycle.

resource imagePullFailureAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-image-pull-failure'
  location: location
  tags: tags
  properties: {
    displayName: 'Image Pull Failure (Critical)'
    description: 'Container image cannot be pulled. App is hard-down. Check GHCR package visibility and registry config.'
    severity: 0
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          // ACA's own diagnostic logs never emit the raw Kubernetes reason
          // string "ImagePullBackOff" — verified against the 2026-07-05 GHCR
          // PAT outage, which produced Reason_s "ContainerBackOff" /
          // "ContainerCrashing" with Log_s describing the pull failure.
          query: '''
            ContainerAppSystemLogs_CL
            | where Reason_s in ("ContainerBackOff", "ContainerCrashing")
            | where Log_s has "pull"
            | summarize Count = count() by RevisionName_s
            | where Count > 0
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

// ── GitHub API Alerts ──
// Alert rules for the GitHub API-first data layer.
// All use the same action group and Log Analytics workspace as the restart alert.

resource rateLimitWarning 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-github-rate-limit-warning'
  location: location
  tags: tags
  properties: {
    displayName: 'GitHub API Rate Limit Warning'
    description: 'Rate limit remaining below 1,000 for 5 minutes. At 145 calls/hr typical, this indicates unusual consumption.'
    severity: 2
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "github.api.rate_limit"
            | where Log_s contains "remaining"
            | extend remaining = toint(extract("remaining.:(\\d+)", 1, Log_s))
            | where remaining < 1000
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

resource rateLimitCritical 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-github-rate-limit-critical'
  location: location
  tags: tags
  properties: {
    displayName: 'GitHub API Rate Limit Critical'
    description: 'Rate limit below 500 or 429 response received. Polling disabled, serving from cache only.'
    severity: 1
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "github.api.error" and Log_s contains "429"
              or (Log_s contains "github.api.rate_limit" and Log_s contains "degraded")
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

resource apiErrorSpike 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-github-api-error-spike'
  location: location
  tags: tags
  properties: {
    displayName: 'GitHub API Error Spike'
    description: 'More than 5 GitHub API errors in 5 minutes. May indicate GitHub outage or auth failure.'
    severity: 1
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "github.api.error"
            | summarize ErrorCount = count()
            | where ErrorCount > 5
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

resource cacheDegraded 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-cache-degraded'
  location: location
  tags: tags
  properties: {
    displayName: 'Cache Hit Rate Degraded'
    description: 'Cache hit rate below 85% over 5 minutes. Indicates excessive cache misses — possible invalidation storm or cache corruption.'
    severity: 2
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "cache.miss"
            | summarize Misses = count()
            | where Misses > 50
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

resource fallbackActive 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-fallback-active'
  location: location
  tags: tags
  properties: {
    displayName: 'Fallback Data Active'
    description: 'App serving from baked fallback data for more than 5 minutes. GitHub API is likely unreachable.'
    severity: 1
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "storage.fallback"
            | summarize FallbackCount = count()
            | where FallbackCount > 0
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

resource branchDivergence 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-branch-divergence'
  location: location
  tags: tags
  properties: {
    displayName: 'Session Branch Divergence'
    description: 'A session branch is more than 10 commits behind main. User may encounter merge conflicts.'
    severity: 3
    enabled: true
    scopes: [ logAnalytics.id ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
            ContainerAppConsoleLogs_CL
            | where Log_s contains "branch.divergence"
            | where Log_s contains "behind_by"
            | extend behind = toint(extract("behind_by.:(\\d+)", 1, Log_s))
            | where behind > 10
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: budgetAlertConfigured ? [ restartAlertActionGroup.id ] : []
    }
  }
}

// ── Ephemeral Runner Module ──
module ephemeralRunner 'runner/runner.bicep' = {
  name: 'ephemeral-runner'
  params: {
    location: location
    uniqueSuffix: uniqueSuffix
    enabled: ephemeralRunnerEnabled
    githubRunnerPat: githubRunnerPat
    githubRunnerWebhookSecret: githubRunnerWebhookSecret
    logAnalyticsWorkspaceId: logAnalytics.id
    keyVaultName: keyVault.name
  }
}

// ── Outputs ──

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output appName string = containerApp.name
output resourceGroup string = resourceGroup().name
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output stagingUrl string = 'https://${containerAppStaging.properties.configuration.ingress.fqdn}'
output appInsightsName string = appInsights.name
output storageAccountName string = storageAccount.name
output storageAccountBlobUrl string = storageAccount.properties.primaryEndpoints.blob
output runnerWebhookUrl string = ephemeralRunner.outputs.webhookUrl
