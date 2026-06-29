// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

export type QuotaLevel = 'info' | 'warning' | 'error';

export interface QuotaWarning {
  milestone: number;
  level: QuotaLevel;
  message: string;
  dismissedAt: number | null;
}

interface QuotaWarningStore {
  warning: QuotaWarning | null;
  dismiss: () => void;
  _onMilestone: (milestone: number, resetsAt?: string) => void;
}

function milestoneToLevel(milestone: number): QuotaLevel {
  if (milestone >= 100) return 'error';
  if (milestone >= 80) return 'warning';
  return 'info';
}

function milestoneMessage(milestone: number, resetsAt?: string): string {
  if (milestone >= 100) {
    const resetStr = resetsAt ? ` Resets at ${formatResetTime(resetsAt)}.` : ' Resets at midnight UTC.';
    return `Daily AI quota reached.${resetStr}`;
  }
  if (milestone >= 95) {
    return "You've almost exhausted your daily AI quota. AI features may become unavailable.";
  }
  return `You've used ${milestone}% of your daily AI quota.`;
}

function formatResetTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    getGlobalRecorder()?.record({
      type: 'system.error', component: 'quota-warning', level: 'debug',
      message: 'Failed to format reset time, using fallback',
      error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
    });
    return 'midnight UTC';
  }
}

export const useQuotaWarning = create<QuotaWarningStore>((set, get) => ({
  warning: null,

  dismiss: () => {
    const { warning } = get();
    if (warning) {
      set({ warning: { ...warning, dismissedAt: Date.now() } });
    }
  },

  _onMilestone: (milestone: number, resetsAt?: string) => {
    const { warning } = get();
    if (warning && warning.milestone >= milestone) return;
    set({
      warning: {
        milestone,
        level: milestoneToLevel(milestone),
        message: milestoneMessage(milestone, resetsAt),
        dismissedAt: null,
      },
    });
  },
}));

export function onQuotaMilestone(milestone: number, resetsAt?: string): void {
  useQuotaWarning.getState()._onMilestone(milestone, resetsAt);
}
