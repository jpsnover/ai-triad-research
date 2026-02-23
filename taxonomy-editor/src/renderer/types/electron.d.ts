export interface ElectronAPI {
  loadTaxonomyFile: (pov: string) => Promise<unknown>;
  saveTaxonomyFile: (pov: string, data: unknown) => Promise<void>;
  loadConflictFiles: () => Promise<unknown[]>;
  saveConflictFile: (claimId: string, data: unknown) => Promise<void>;
  createConflictFile: (claimId: string, data: unknown) => Promise<void>;
  deleteConflictFile: (claimId: string) => Promise<void>;
  setApiKey: (key: string) => Promise<void>;
  hasApiKey: () => Promise<boolean>;
  computeEmbeddings: (texts: string[]) => Promise<{ vectors: number[][] }>;
  computeQueryEmbedding: (text: string) => Promise<{ vector: number[] }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
