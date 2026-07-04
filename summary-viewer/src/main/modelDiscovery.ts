import path from 'path';
import { loadApiKey as _loadApiKey } from './apiKeyStore';
import {
  refreshAIModels as _refreshAIModels,
  type RefreshResult,
  type ModelEntry,
  type AIModelsConfig,
} from '../../../lib/electron-shared/modelDiscovery.js';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export type { RefreshResult, ModelEntry, AIModelsConfig };

export async function refreshAIModels(): Promise<RefreshResult> {
  return _refreshAIModels({
    loadApiKey: (backend: string) => _loadApiKey(backend as Parameters<typeof _loadApiKey>[0]),
    repoRoot: PROJECT_ROOT,
  });
}
