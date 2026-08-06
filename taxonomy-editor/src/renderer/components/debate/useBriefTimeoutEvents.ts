// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { useDebateStore } from '../../hooks/useDebateStore';
import { POVER_INFO } from '@lib/debate/types';
import type { SpeakerId } from '@lib/debate/types';

// Event shapes shared with the bridge layer (Rosetta Stone e/62 adds these to AppAPI).
// Defined locally here until types.ts is updated; the guard below keeps this safe at runtime.
export interface BriefTimeoutEvent {
  debateId: string;
  speaker: string; // stable pov key: "safetyist" | "accelerationist" | "skeptic"
  attempt: number;
  maxAttempts: number;
  currentModel: string;
}

export interface BriefRetriesExhaustedEvent {
  debateId: string;
  speaker: string; // stable pov key
  totalAttempts: number;
  currentModel: string;
}

export interface BriefTimeoutToastData extends BriefTimeoutEvent {
  speakerLabel: string;
}

export interface BriefTimeoutDialogData extends BriefRetriesExhaustedEvent {
  speakerLabel: string;
}

export interface UseBriefTimeoutEventsResult {
  toastData: BriefTimeoutToastData | null;
  dialogData: BriefTimeoutDialogData | null;
  dismissToast: () => void;
  dismissDialog: () => void;
  retryWithModel: (model: string) => void;
  promoteToDiag: () => void; // promote mid-retry toast to exhausted dialog
}

function speakerLabel(speakerId: string): string {
  const info = POVER_INFO[speakerId as Exclude<SpeakerId, 'user'>];
  return info?.label ?? speakerId;
}

type BriefTimeoutBridge = {
  onBriefTimeout: (cb: (e: BriefTimeoutEvent) => void) => () => void;
  onBriefRetriesExhausted: (cb: (e: BriefRetriesExhaustedEvent) => void) => () => void;
};

// Type guard for the bridge additions (Rosetta Stone e/62 + ElectronMain preload).
// The renderer-side wrapper exists in api once Rosetta Stone lands, but calling it
// delegates to window.electronAPI which requires the preload to be wired too.
// Guard at the preload layer to avoid a "is not a function" crash in the interim.
function briefTimeoutBridge(): BriefTimeoutBridge | null {
  const electronAPI = (window as unknown as Record<string, unknown>)['electronAPI'] as Record<string, unknown> | undefined;
  if (electronAPI) {
    // Electron mode: require the preload to actually expose both handlers
    if (typeof electronAPI['onBriefTimeout'] === 'function' && typeof electronAPI['onBriefRetriesExhausted'] === 'function') {
      return api as unknown as BriefTimeoutBridge;
    }
    return null; // preload not yet wired — no-op until ElectronMain lands it
  }
  // Web mode: check api directly (web-bridge stubs land via t/2218)
  const a = api as unknown as Record<string, unknown>;
  if (typeof a['onBriefTimeout'] === 'function' && typeof a['onBriefRetriesExhausted'] === 'function') {
    return api as unknown as BriefTimeoutBridge;
  }
  return null;
}

export function useBriefTimeoutEvents(activeDebateId: string | null): UseBriefTimeoutEventsResult {
  const [toastData, setToastData] = useState<BriefTimeoutToastData | null>(null);
  const [dialogData, setDialogData] = useState<BriefTimeoutDialogData | null>(null);

  useEffect(() => {
    const bridge = briefTimeoutBridge();
    if (!bridge) return; // no-op until Rosetta Stone lands the bridge additions

    const unsubTimeout = bridge.onBriefTimeout((e) => {
      if (activeDebateId && e.debateId !== activeDebateId) return;
      setToastData({ ...e, speakerLabel: speakerLabel(e.speaker) });
    });

    const unsubExhausted = bridge.onBriefRetriesExhausted((e) => {
      if (activeDebateId && e.debateId !== activeDebateId) return;
      setToastData(null);
      setDialogData({ ...e, speakerLabel: speakerLabel(e.speaker) });
    });

    return () => {
      unsubTimeout();
      unsubExhausted();
    };
  }, [activeDebateId]);

  const dismissToast = useCallback(() => setToastData(null), []);
  const dismissDialog = useCallback(() => setDialogData(null), []);

  // Centralized retry action (t/2210#3 — don't duplicate setState across containers).
  // An explicit debateModel from retry wins over any reset-to-global (t/2213 compat:
  // that reset only fires on new debate creation, not mid-run setState calls).
  const retryWithModel = useCallback((model: string) => {
    setDialogData(null);
    setToastData(null);
    useDebateStore.setState({ debateModel: model });
    getGlobalRecorder()?.record({
      type: 'debate.lifecycle',
      component: 'brief-timeout',
      level: 'info',
      message: 'Retrying opening statements with new model after brief timeout',
      data: { model },
    });
    void useDebateStore.getState().runOpeningStatements();
  }, []);

  // User clicks "Switch model" on the toast before retries are exhausted —
  // promote to the dialog early so they can act without waiting for final failure.
  const promoteToDiag = useCallback(() => {
    if (!toastData) return;
    setDialogData({
      debateId: toastData.debateId,
      speaker: toastData.speaker,
      speakerLabel: toastData.speakerLabel,
      totalAttempts: toastData.attempt,
      currentModel: toastData.currentModel,
    });
    setToastData(null);
  }, [toastData]);

  return { toastData, dialogData, dismissToast, dismissDialog, retryWithModel, promoteToDiag };
}
