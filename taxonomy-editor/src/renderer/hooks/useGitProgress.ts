// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Zustand store for tracking the progress of long-running git operations.
 *
 * Each git operation has a hard-coded sequence of steps. The sync API layer
 * calls `startOp` / `stepOp` / `completeOp` / `failOp` to drive state,
 * and `<GitProgressBanner>` renders the result.
 */

import { create } from 'zustand';

export type GitOperation = 'create-pr' | 'resync' | 'discard' | 'download' | 'push' | 'fetch-origin' | 'reset-main';

export interface GitProgress {
  active: boolean;
  operation: GitOperation;
  label: string;
  step: string;
  stepIndex: number;
  stepTotal: number;
  startTime: number;
  error: string | null;
  success: boolean;
}

const STEP_SEQUENCES: Record<GitOperation, string[]> = {
  'create-pr': ['Committing changes...', 'Pushing branch...', 'Opening pull request...'],
  'resync':    ['Fetching from origin...', 'Rebasing session branch...', 'Verifying state...'],
  'discard':   ['Resetting working tree...'],
  'download':  ['Fetching from GitHub...', 'Updating local files...'],
  'push':      ['Pushing to remote...'],
  'fetch-origin': ['Fetching from origin...', 'Updating refs...'],
  'reset-main':   ['Fetching from origin...', 'Resetting to origin/main...', 'Verifying state...'],
};

interface GitProgressStore {
  progress: GitProgress | null;
  startOp: (operation: GitOperation) => void;
  stepOp: (stepIndex: number) => void;
  completeOp: () => void;
  failOp: (error: string) => void;
  dismiss: () => void;
}

export const useGitProgress = create<GitProgressStore>((set, get) => ({
  progress: null,

  startOp: (operation) => {
    const steps = STEP_SEQUENCES[operation];
    set({
      progress: {
        active: true,
        operation,
        label: steps[0],
        step: steps[0],
        stepIndex: 0,
        stepTotal: steps.length,
        startTime: Date.now(),
        error: null,
        success: false,
      },
    });
  },

  stepOp: (stepIndex) => {
    const p = get().progress;
    if (!p || !p.active) return;
    const steps = STEP_SEQUENCES[p.operation];
    const clamped = Math.min(stepIndex, steps.length - 1);
    set({
      progress: {
        ...p,
        stepIndex: clamped,
        step: steps[clamped],
        label: steps[clamped],
      },
    });
  },

  completeOp: () => {
    const p = get().progress;
    if (!p) return;
    set({
      progress: {
        ...p,
        active: false,
        success: true,
        label: 'Done',
        step: 'Done',
      },
    });
  },

  failOp: (error) => {
    const p = get().progress;
    if (!p) return;
    set({
      progress: {
        ...p,
        active: false,
        error,
        label: 'Failed',
      },
    });
  },

  dismiss: () => set({ progress: null }),
}));
