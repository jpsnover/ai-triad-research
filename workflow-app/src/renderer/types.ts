export type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cancelled';

export interface StepDefinition {
  id: string;
  name: string;
  description: string;
  phase: string;
  canSkip: boolean;
  requiresConfig: boolean;
}

export interface StepState {
  id: string;
  status: StepStatus;
  log: string;
  errorLog: string;
  summary: string;
  startTime?: number;
  endTime?: number;
  config: Record<string, unknown>;
}

export interface Proposal {
  action: string;
  suggested_id: string;
  label: string;
  pov: string;
  category: string;
  rationale: string;
  evidence_doc_ids: string[];
  status: string;
}

export interface ProposalFile {
  generated_at: string;
  model: string;
  taxonomy_version: string;
  proposals: Proposal[];
}

declare global {
  interface Window {
    electronAPI: {
      getStepDefinitions: () => Promise<StepDefinition[]>;
      runStep: (stepId: string, config: Record<string, unknown>) => Promise<{ exitCode: number }>;
      cancelStep: () => Promise<void>;
      getGitStatus: () => Promise<{ summary: string; hasChanges: boolean }>;
      getGitDiffStat: () => Promise<string>;
      listProposalFiles: () => Promise<string[]>;
      readProposalFile: (filePath: string) => Promise<ProposalFile | null>;
      selectFiles: () => Promise<string[]>;
      getDataRoot: () => Promise<string>;
      onStepOutput: (callback: (text: string) => void) => () => void;
      onStepError: (callback: (text: string) => void) => () => void;
    };
  }
}
