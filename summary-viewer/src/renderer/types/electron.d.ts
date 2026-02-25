export interface AddTaxonomyNodeRequest {
  pov: string;
  category: string;
  label: string;
  description: string;
}

export interface AddTaxonomyNodeResult {
  success: boolean;
  nodeId: string;
  error?: string;
}

export interface ElectronAPI {
  discoverSources: () => Promise<unknown[]>;
  loadSummary: (docId: string) => Promise<unknown>;
  loadSnapshot: (sourceId: string) => Promise<string>;
  loadTaxonomy: () => Promise<unknown>;
  addTaxonomyNode: (req: AddTaxonomyNodeRequest) => Promise<AddTaxonomyNodeResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
