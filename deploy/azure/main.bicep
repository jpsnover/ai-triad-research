// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// ═══════════════════════════════════════════════════════════════════════════════
// Azure Container Apps deployment for Taxonomy Editor
//
// Resources created:
//   - Container Apps Environment (serverless, scale-to-zero)
//   - Container App (the Taxonomy Editor)
//   - Storage Account + Azure Files share (persistent data)
//   - Log Analytics Workspace (diagnostics)
//
// Usage:
//   az deployment group create -g ai-triad -f main.bicep \
//     --parameters geminiApiKey=<key>
// ═══════════════════════════════════════════════════════════════════════════════

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Container image (ghcr.io/jpsnover/taxonomy-editor:latest)')
param containerImage string = 'ghcr.io/jpsnover/taxonomy-editor:latest'

@description('Gemini API key for AI operations')
@secure()
param geminiApiKey string

@description('Anthropic API key (optional)')
@secure()
param anthropicApiKey string = ''

@description('Groq API key (optional)')
@secure()
param groqApiKey string = ''

@description('Unique suffix for globally unique resource names')
param uniqueSuffix string = uniqueString(resourceGroup().id)

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

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'taxonomy-editor'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 7862
        transport: 'auto' // supports both HTTP and WebSocket
        allowInsecure: false
      }
      secrets: [
        { name: 'gemini-key', value: geminiApiKey }
        { name: 'anthropic-key', value: anthropicApiKey }
        { name: 'groq-key', value: groqApiKey }
      ]
      registries: [
        {
          server: 'ghcr.io'
          // Public image — no credentials needed for read access
          // If private, add: username + passwordSecretRef
        }
      ]
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
          env: [
            { name: 'AI_TRIAD_DATA_ROOT', value: '/data' }
            { name: 'GEMINI_API_KEY', secretRef: 'gemini-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-key' }
            { name: 'GROQ_API_KEY', secretRef: 'groq-key' }
            { name: 'ALLOWED_ORIGINS', value: '' } // Set after deployment: https://<app-fqdn>
            { name: 'HOME', value: '/home/aitriad' }
            { name: 'NODE_ENV', value: 'production' }
          ]
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

// ── Outputs ──

output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output appName string = containerApp.name
output resourceGroup string = resourceGroup().name
output storageAccountName string = storageAccount.name
output fileShareName string = dataShare.name
