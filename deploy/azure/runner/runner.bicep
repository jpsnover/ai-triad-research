// Ephemeral GitHub Actions Runner — Azure Function + ACI
//
// An Azure Function receives GitHub workflow_job webhooks and creates
// short-lived ACI container groups that register as --ephemeral runners.
// After the job completes, the webhook deletes the container group.
// Cost: ~$0 idle, ~$0.05/build.

@description('Azure region')
param location string = resourceGroup().location

@description('Unique suffix for globally unique names')
param uniqueSuffix string = uniqueString(resourceGroup().id)

@description('GitHub PAT with admin:org or repo scope for runner registration tokens')
@secure()
param githubRunnerPat string = ''

@description('HMAC secret for verifying GitHub webhook signatures')
@secure()
param githubRunnerWebhookSecret string = ''

@description('GitHub repository owner')
param githubOwner string = 'jpsnover'

@description('GitHub repository name')
param githubRepo string = 'ai-triad-research'

@description('Runner container image')
param runnerImage string = 'myoung34/github-runner:latest'

@description('Runner CPU cores')
param runnerCpu string = '2'

@description('Runner memory in GB')
param runnerMemory string = '4'

@description('Runner labels (comma-separated)')
param runnerLabels string = 'self-hosted,aci'

@description('Enable the ephemeral runner infrastructure')
param enabled bool = false

@description('Log Analytics workspace ID for diagnostics')
param logAnalyticsWorkspaceId string = ''

// ── Resource Tags ──
var tags = {
  project: 'ai-triad-research'
  component: 'ephemeral-runner'
  'managed-by': 'bicep'
}

// ── Storage Account (required by Azure Functions) ──
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = if (enabled) {
  name: 'strunner${uniqueSuffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// ── App Service Plan (Consumption / Serverless) ──
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = if (enabled) {
  name: 'plan-runner-${uniqueSuffix}'
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

// ── Function App ──
resource functionApp 'Microsoft.Web/sites@2023-12-01' = if (enabled) {
  name: 'func-runner-${uniqueSuffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      appSettings: [
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING', value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'WEBSITE_CONTENTSHARE', value: 'runner-func-${uniqueSuffix}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~20' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
        { name: 'RUNNER_RESOURCE_GROUP', value: resourceGroup().name }
        { name: 'RUNNER_LOCATION', value: location }
        { name: 'RUNNER_IMAGE', value: runnerImage }
        { name: 'RUNNER_CPU', value: runnerCpu }
        { name: 'RUNNER_MEMORY', value: runnerMemory }
        { name: 'RUNNER_LABELS', value: runnerLabels }
        { name: 'GITHUB_OWNER', value: githubOwner }
        { name: 'GITHUB_REPO', value: githubRepo }
        { name: 'GITHUB_RUNNER_PAT', value: githubRunnerPat }
        { name: 'GITHUB_RUNNER_WEBHOOK_SECRET', value: githubRunnerWebhookSecret }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: !empty(logAnalyticsWorkspaceId) ? '' : '' }
      ]
    }
  }
}

// ── RBAC: Function → Contributor on RG (to create/delete ACI groups) ──
resource contributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enabled) {
  name: guid(resourceGroup().id, functionApp.id, 'Contributor')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c') // Contributor
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ──
output functionAppName string = enabled ? functionApp.name : ''
output functionAppUrl string = enabled ? 'https://${functionApp.properties.defaultHostName}' : ''
output webhookUrl string = enabled ? 'https://${functionApp.properties.defaultHostName}/api/github-webhook' : ''
