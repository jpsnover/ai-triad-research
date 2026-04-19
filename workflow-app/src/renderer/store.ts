import { create } from 'zustand';
import type { StepDefinition, StepState, StepStatus } from './types';

interface PipelineStore {
  definitions: StepDefinition[];
  steps: Record<string, StepState>;
  activeStepId: string | null;
  expandedStepId: string | null;
  pipelineRunning: boolean;
  dataRoot: string;

  setDefinitions: (defs: StepDefinition[]) => void;
  setDataRoot: (root: string) => void;
  setStepStatus: (id: string, status: StepStatus) => void;
  appendLog: (id: string, text: string) => void;
  appendErrorLog: (id: string, text: string) => void;
  clearLog: (id: string) => void;
  setStepSummary: (id: string, summary: string) => void;
  setStepConfig: (id: string, config: Record<string, unknown>) => void;
  setActiveStep: (id: string | null) => void;
  setExpandedStep: (id: string | null) => void;
  setPipelineRunning: (running: boolean) => void;
  markStepStart: (id: string) => void;
  markStepEnd: (id: string) => void;
  resetAll: () => void;
}

function makeInitialSteps(defs: StepDefinition[]): Record<string, StepState> {
  const steps: Record<string, StepState> = {};
  for (const def of defs) {
    steps[def.id] = {
      id: def.id,
      status: 'pending',
      log: '',
      errorLog: '',
      summary: '',
      config: {},
    };
  }
  return steps;
}

export const usePipelineStore = create<PipelineStore>((set) => ({
  definitions: [],
  steps: {},
  activeStepId: null,
  expandedStepId: null,
  pipelineRunning: false,
  dataRoot: '',

  setDefinitions: (defs) => set({ definitions: defs, steps: makeInitialSteps(defs) }),
  setDataRoot: (root) => set({ dataRoot: root }),
  setStepStatus: (id, status) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], status } },
    })),
  appendLog: (id, text) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], log: s.steps[id].log + text } },
    })),
  appendErrorLog: (id, text) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], errorLog: s.steps[id].errorLog + text } },
    })),
  clearLog: (id) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], log: '', errorLog: '' } },
    })),
  setStepSummary: (id, summary) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], summary } },
    })),
  setStepConfig: (id, config) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], config } },
    })),
  setActiveStep: (id) => set({ activeStepId: id }),
  setExpandedStep: (id) => set({ expandedStepId: id }),
  setPipelineRunning: (running) => set({ pipelineRunning: running }),
  markStepStart: (id) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], startTime: Date.now() } },
    })),
  markStepEnd: (id) =>
    set((s) => ({
      steps: { ...s.steps, [id]: { ...s.steps[id], endTime: Date.now() } },
    })),
  resetAll: () =>
    set((s) => ({
      steps: makeInitialSteps(s.definitions),
      activeStepId: null,
      expandedStepId: null,
      pipelineRunning: false,
    })),
}));
