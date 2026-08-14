// Minimal fixture for BicepEnvDrift.Tests.ps1 — drifted baseline.
// NODE_ENV changed to 'staging' without updating deploy-azure.yml.

var baseEnv = [
  { name: 'AI_TRIAD_DATA_ROOT', value: '/mnt/shared' }
  { name: 'TAXONOMY_CACHE_DIR', value: '/mnt/shared' }
  { name: 'ALLOWED_ORIGINS', value: 'https://taxonomy-editor.${someResource.properties.domain}' }
  { name: 'HOME', value: '/home/aitriad' }
  { name: 'NODE_ENV', value: 'staging' }
  { name: 'AZURE_KEYVAULT_URL', value: keyVault.properties.vaultUri }
  { name: 'ADMIN_USERS', value: adminUsers }
  { name: 'WEBSITE_AUTH_ENABLED', value: 'true' }
]
