// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { clearSessionDismiss, shouldShowGeminiOnboarding } from '../components/settings/geminiOnboardingState';

type CloseResult = 'saved' | 'later' | 'permanent-dismiss';

export function useGeminiOnboarding() {
  const [showModal, setShowModal] = useState(false);
  // t/3500: threaded through to the modal so it can render "Gemini access provided"
  // in place of the key input for allowlisted users, instead of the input + Save flow.
  const [geminiAllowlisted, setGeminiAllowlisted] = useState(false);
  const resolveRef = useRef<((result: CloseResult) => void) | null>(null);

  useEffect(() => {
    clearSessionDismiss();
  }, []);

  const checkAndShow = useCallback(async (opts?: { freeTier?: boolean; geminiAllowlisted?: boolean }): Promise<boolean> => {
    if (opts?.freeTier) return true;
    if (!shouldShowGeminiOnboarding()) return true;
    try {
      const hasKey = await api.hasApiKey('gemini');
      if (hasKey) return true;
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'gemini-onboarding',
        level: 'warn',
        message: 'Failed to check Gemini key status',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      return true;
    }

    setGeminiAllowlisted(!!opts?.geminiAllowlisted);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = () => resolve(true);
      setShowModal(true);
    });
  }, []);

  const handleClose = useCallback((result: CloseResult) => {
    setShowModal(false);
    resolveRef.current?.(result);
    resolveRef.current = null;
  }, []);

  return {
    showModal,
    modalProps: { open: showModal, onClose: handleClose, geminiAllowlisted },
    checkAndShow,
  };
}
