// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef, useState } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

const isWeb = import.meta.env.VITE_TARGET === 'web';
const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';
const DISMISS_KEY = 'gemini-onboarding-dismissed';

type ModalState = 'idle' | 'validating' | 'success' | 'error';
type CloseResult = 'saved' | 'later' | 'permanent-dismiss';

interface GeminiOnboardingModalProps {
  open: boolean;
  onClose: (result: CloseResult) => void;
}

export function GeminiOnboardingModal({ open, onClose }: GeminiOnboardingModalProps) {
  const [key, setKey] = useState('');
  const [state, setState] = useState<ModalState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [hasOtherKeys, setHasOtherKeys] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setKey('');
    setState('idle');
    setErrorMsg('');
    // TL note: default to strong headline (false) if this throws
    api.getApiKeySummary()
      .then((summary) => {
        setHasOtherKeys(summary.some((s) => s.hasKey));
      })
      .catch((err) => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'gemini-onboarding',
          level: 'warn',
          message: 'Failed to fetch API key summary',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
        setHasOtherKeys(false);
      });
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  if (!open) return null;

  const headline = hasOtherKeys ? 'Add Gemini for Free-Tier Access' : 'Get Free AI Features';

  const handleOpenStudio = () => {
    if (isWeb) {
      window.open(AI_STUDIO_URL, '_blank');
    } else {
      api.openExternal(AI_STUDIO_URL).catch((err) => {
        getGlobalRecorder()?.record({
          type: 'system.error',
          component: 'gemini-onboarding',
          level: 'warn',
          message: 'Failed to open AI Studio',
          error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
        });
      });
    }
  };

  const handleSave = async () => {
    if (!key.trim() || state === 'validating') return;
    setState('validating');
    setErrorMsg('');
    try {
      const result = await api.validateApiKey(key.trim(), 'gemini');
      if (!result.valid) {
        setState('error');
        setErrorMsg(result.error ?? 'Invalid key — check that you copied the full key');
        return;
      }
      await api.addApiKey(key.trim(), 'gemini');
      setState('success');
      setTimeout(() => onClose('saved'), 1500);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'gemini-onboarding',
        level: 'error',
        message: 'Key validation failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack },
      });
      setState('error');
      setErrorMsg('Something went wrong — please try again');
    }
  };

  const handleDismiss = (result: CloseResult) => {
    if (result === 'later') {
      localStorage.setItem(DISMISS_KEY, 'once');
    } else if (result === 'permanent-dismiss') {
      localStorage.setItem(DISMISS_KEY, 'permanent');
    }
    onClose(result);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleDismiss('later');
    if (e.key === 'Enter' && key.trim() && state !== 'validating') handleSave();
  };

  return (
    <div
      className="dialog-overlay"
      onClick={() => handleDismiss('later')}
      onKeyDown={handleKeyDown}
    >
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gemini-onboarding-title"
        style={{ maxWidth: 480 }}
      >
        <h3 id="gemini-onboarding-title">{headline}</h3>

        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 12 }}>
            Gemini offers a generous free tier for AI features like debate, chat, and fact-checking.
            Get your API key in three steps:
          </p>
          <ol style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
            <li>
              <button
                className="btn btn-sm"
                onClick={handleOpenStudio}
                style={{ marginLeft: 4 }}
              >
                Open Google AI Studio
              </button>
            </li>
            <li>Click <strong>"Create API Key"</strong> and copy the key</li>
            <li>Paste the key below and click Save</li>
          </ol>
        </div>

        <div className="form-group">
          <label htmlFor="gemini-key-input">API Key</label>
          <input
            id="gemini-key-input"
            ref={inputRef}
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); if (state === 'error') setState('idle'); }}
            placeholder="AIza..."
            disabled={state === 'validating' || state === 'success'}
            autoComplete="off"
          />
        </div>

        {state === 'error' && (
          <div className="error-text" style={{ marginBottom: 12 }}>
            {errorMsg}
          </div>
        )}

        {state === 'success' && (
          <div style={{ color: 'var(--color-success, #22c55e)', marginBottom: 12, fontWeight: 500 }}>
            &#10003; Key saved!
          </div>
        )}

        <div className="dialog-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            className="btn"
            onClick={() => handleDismiss('permanent-dismiss')}
            disabled={state === 'validating' || state === 'success'}
            style={{ fontSize: '0.85em' }}
          >
            I use a different AI
          </button>
          <button
            className="btn"
            onClick={() => handleDismiss('later')}
            disabled={state === 'validating' || state === 'success'}
          >
            I'll do this later
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!key.trim() || state === 'validating' || state === 'success'}
          >
            {state === 'validating' ? 'Validating...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function shouldShowGeminiOnboarding(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  return dismissed !== 'permanent';
}

export function clearSessionDismiss(): void {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (dismissed === 'once') localStorage.removeItem(DISMISS_KEY);
}
