// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/4030 (t/3553; TL t/3553#5, SO e/263): a saved model selection the registry no longer lists. After
// t/3553 a full registry refresh can retire unreferenced models; pinned ones (defaults, debate tiers,
// chains) stay, so the user's own saved choice is the remaining way to hold a retired id.
//
// getStoredModel() runs on every chat turn, harvest call, and so on, so this de-duplicates: the WARN
// (Fallback-Path Logging, root AGENTS.md) fires once per session per retired id, and the notice once,
// with a dismissal remembered across sessions. The saved choice itself is NOT rewritten: if the model
// comes back in a later refresh, it is used again.
//
// Standalone on purpose: getStoredModel() is called while the taxonomy store is being built, so it
// cannot write into that store without a cycle.

import { create } from 'zustand';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

/** The retired id last dismissed by the user; its notice is not shown again. */
export const RETIRED_MODEL_ACK_KEY = 'taxonomy-editor-retired-model-ack';

export interface RetiredModelNotice {
  stored: string;
  fallback: string;
}

interface RetiredModelNoticeState {
  notice: RetiredModelNotice | null;
  dismiss: () => void;
}

const reportedThisSession = new Set<string>();

export const useRetiredModelNotice = create<RetiredModelNoticeState>((set, get) => ({
  notice: null,
  dismiss: () => {
    const current = get().notice;
    if (current) {
      try {
        localStorage.setItem(RETIRED_MODEL_ACK_KEY, current.stored);
      } catch (err) {
        getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to remember the retired-model notice dismissal', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
      }
    }
    set({ notice: null });
  },
}));

function acknowledged(stored: string): boolean {
  try {
    return localStorage.getItem(RETIRED_MODEL_ACK_KEY) === stored;
  } catch (err) {
    getGlobalRecorder()?.record({ type: 'system.error', component: 'taxonomy-store', level: 'warn', message: 'Failed to read the retired-model notice dismissal', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
    return false;
  }
}

/** Report that the saved model `stored` is not in the registry and `fallback` is used instead. */
export function reportRetiredModel(stored: string, fallback: string): void {
  if (reportedThisSession.has(stored)) return;
  reportedThisSession.add(stored);
  getGlobalRecorder()?.record({
    type: 'state.change', component: 'taxonomy-store', level: 'warn',
    message: `Saved model "${stored}" is no longer in the model registry; using "${fallback}" (t/4030)`,
    data: { stored, fallback },
  });
  if (!acknowledged(stored)) useRetiredModelNotice.setState({ notice: { stored, fallback } });
}

/** Test seam: forget this session's reports. */
export function __resetRetiredModelNoticeForTests(): void {
  reportedThisSession.clear();
  useRetiredModelNotice.setState({ notice: null });
}
