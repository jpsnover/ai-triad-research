import { loadApiKey as _loadApiKey } from './apiKeyStore.js';
import { PROJECT_ROOT } from './fileIO.js';
import {
  refreshAIModels as _refreshAIModels,
  type RefreshResult,
  type ModelEntry,
  type AIModelsConfig,
  type ModelDiscoveryDeps,
} from '../../../lib/electron-shared/modelDiscovery.js';

export type { RefreshResult, ModelEntry, AIModelsConfig, ModelDiscoveryDeps };

export async function refreshAIModels(): Promise<RefreshResult> {
  return _refreshAIModels({
    loadApiKey: (backend: string) => _loadApiKey(backend as Parameters<typeof _loadApiKey>[0]),
    repoRoot: PROJECT_ROOT,
  });
}
