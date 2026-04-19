// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ═══════════════════════════════════════════════════════════════════════════════
// Azure Container Apps deployment for Taxonomy Editor
//
// BYOK (Bring Your Own Key) model: API keys are NOT passed at deployment time.
// Users enter their own Gemini/Claude/Groq API keys through the app UI.
// Keys are encrypted (AES-256-GCM) and stored on the Azure Files data volume.
//
// Resources created:
//   - Container Apps Environment (serverless, scale-to-zero)
//   - Container App (the Taxonomy Editor, system-assigned managed identity)
//   - Storage Account + Azure Files share (persistent data)
//   - Log Analytics Workspace (diagnostics)
//   - Key Vault (per-user BYOK secrets, accessed via managed identity)
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

@description('Set to "1" (default) to allow anonymous access. Set to empty string to enforce the sign-in gate (requires authorized-users.json on the data volume).')
param authDisabled string = '1'

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
@description('GitHub PAT with read:packages scope for pulling container images from ghcr.io')
param ghcrPassword string = ''

var googleEnabled = !empty(googleClientId) && !empty(googleClientSecret)
var githubEnabled = !empty(githubClientId) && !empty(githubClientSecret)
var googleClientSecretName = 'google-client-secret'
var githubClientSecretName = 'github-client-secret'
var githubTokenSecretName = 'github-sync-token'
var githubWebhookSecretName = 'github-webhook-secret'
var githubTokenProvided = !empty(githubToken)
var githubWebhookSecretProvided = !empty(githubWebhookSecret)
var ghcrConfigured = !empty(ghcrPassword)
var ghcrSecretName = 'ghcr-password'
var oauthSecrets = concat(
  googleEnabled ? [ { name: googleClientSecretName, value: googleClientSecret } ] : [],
  githubEnabled ? [ { name: githubClientSecretName, value: githubClientSecret } ] : [],
  githubTokenProvided ? [ { name: githubTokenSecretName, value: githubToken } ] : [],
  githubWebhookSecretProvided ? [ { name: githubWebhookSecretName, value: githubWebhookSecret } ] : [],
  ghcrConfigured ? [ { name: ghcrSecretName, value: ghcrPassword } ] : []
)

// ── Log Analytics ──

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-aitriad-${uniqueSuffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Storage Account + File Share ──

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'staitriad${uniqueSuffix}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource dataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'taxonomy-data'
  properties: {
    shareQuota: 10 // GB — plenty for taxonomy, debates, summaries
  }
}

// ── Key Vault (per-user BYOK secrets) ──
// Uses RBAC authorization; the container app's system-assigned managed
// identity is granted 'Key Vault Secrets Officer' on this vault below.
// Secret names: apikey-<backend>-<sha256(principal)[:32]>

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-ait-${uniqueSuffix}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// ── Container Apps Environment ──

resource containerAppEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-aitriad'
  location: location
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

// Storage mount on the environment
resource storageMount 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: containerAppEnv
  name: 'taxonomy-data'
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: dataShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// ── Container App ──

var baseEnv = [
  { name: 'AI_TRIAD_DATA_ROOT', value: '/data' }
  { name: 'ALLOWED_ORIGINS', value: '' } // Set after deployment: https://<app-fqdn>
  { name: 'HOME', value: '/home/aitriad' }
  { name: 'NODE_ENV', value: 'production' }
  // BYOK model: users enter keys via the app UI. In Azure the server
  // routes them to Key Vault (one secret per user+backend), accessed
  // via the container app's system-assigned managed identity.
  { name: 'AZURE_KEYVAULT_URL', value: keyVault.properties.vaultUri }
  // Auth gate: '1' (default) = anonymous access allowed. Set to ''
  // to enforce sign-in (requires authorized-users.json on /data).
  { name: 'AUTH_DISABLED', value: authDisabled }
  // GitHub sync (Phase-2). GIT_SYNC_ENABLED is the master switch;
  // githubAppAuth.ts tries App credentials first, then GITHUB_TOKEN.
  // The App private key itself lives in Key Vault and is fetched by
  // name via the managed identity; it is never injected as an env.
  { name: 'GIT_SYNC_ENABLED', value: gitSyncEnabled }
  { name: 'GITHUB_REPO', value: githubRepo }
  { name: 'GITHUB_APP_ID', value: githubAppId }
  { name: 'GITHUB_APP_INSTALLATION_ID', value: githubAppInstallationId }
  { name: 'GITHUB_APP_PRIVATE_KEY_SECRET_NAME', value: githubAppPrivateKeySecretName }
]
var envWithToken = githubTokenProvided
  ? concat(baseEnv, [ { name: 'GITHUB_TOKEN', secretRef: githubTokenSecretName } ])
  : baseEnv
var containerEnv = githubWebhookSecretProvided
  ? concat(envWithToken, [ { name: 'GITHUB_WEBHOOK_SECRET', secretRef: githubWebhookSecretName } ])
  : envWithToken

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'taxonomy-editor'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 7862
        transport: 'auto' // supports both HTTP and WebSocket
        allowInsecure: false
      }
      secrets: oauthSecrets
      registries: ghcrConfigured ? [
        {
          server: 'ghcr.io'
          username: 'jpsnover'
          passwordSecretRef: ghcrSecretName
        }
      ] : []
    }
    template: {
      containers: [
        {
          name: 'taxonomy-editor'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: containerEnv
          volumeMounts: [
            { volumeName: 'data', mountPath: '/data' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 7862 }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Startup'
              httpGet: { path: '/health', port: 7862 }
              periodSeconds: 5
              failureThreshold: 10
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'data'
          storageName: 'taxonomy-data'
          storageType: 'AzureFile'
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http-scaler'
            http: { metadata: { concurrentRequests: '10' } }
          }
        ]
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
    }
    login: {
      routes: {
        logoutEndpoint: '/.auth/logout'
      }
      preserveUrlFragmentsForLogins: false
      tokenStore: {
        enabled: true
      }
    }
  }
}

// ── Outputs ──

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output appName string = containerApp.name
output resourceGroup string = resourceGroup().name
output storageAccountName string = storageAccount.name
output fileShareName string = dataShare.name
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
