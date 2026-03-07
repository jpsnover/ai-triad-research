// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'apikey' | 'done';

export default function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [key, setKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const setHasApiKey = useAnalysisStore(s => s.setHasApiKey);

  const handleValidateAndSave = async () => {
    if (!key.trim()) return;
    setValidating(true);
    setError('');

    try {
      const result = await window.electronAPI.validateApiKey(key.trim());
      if (result.valid) {
        await window.electronAPI.storeApiKey(key.trim());
        setHasApiKey(true);
        setStep('done');
      } else {
        setError(result.error || 'Invalid API key');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const handleSkip = () => {
    setStep('done');
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-panel">
        {step === 'welcome' && (
          <>
            <div className="onboarding-icon">&#128202;</div>
            <h2 className="onboarding-title">Welcome to POViewer</h2>
            <p className="onboarding-text">
              POViewer analyzes research documents across AI governance perspectives
              using Google Gemini. Let&apos;s get you set up.
            </p>
            <button className="onboarding-btn-primary" onClick={() => setStep('apikey')}>
              Get Started
            </button>
          </>
        )}

        {step === 'apikey' && (
          <>
            <div className="onboarding-icon">&#128273;</div>
            <h2 className="onboarding-title">Gemini API Key</h2>
            <p className="onboarding-text">
              Enter your Google Gemini API key to enable AI-powered analysis.
              Get one from aistudio.google.com.
            </p>
            <input
              type="password"
              className="onboarding-input"
              placeholder="Enter your Gemini API key"
              value={key}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleValidateAndSave(); }}
              autoFocus
            />
            {error && <div className="onboarding-error">{error}</div>}
            <div className="onboarding-actions">
              <button className="onboarding-btn-secondary" onClick={handleSkip}>
                Skip for Now
              </button>
              <button
                className="onboarding-btn-primary"
                onClick={handleValidateAndSave}
                disabled={!key.trim() || validating}
              >
                {validating ? 'Validating...' : 'Validate & Save'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="onboarding-icon">&#10003;</div>
            <h2 className="onboarding-title">You&apos;re All Set!</h2>
            <p className="onboarding-text">
              Add source documents and taxonomy files, then click &quot;Analyze with Gemini&quot;
              to start mapping perspectives.
            </p>
            <button className="onboarding-btn-primary" onClick={onComplete}>
              Start Using POViewer
            </button>
          </>
        )}
      </div>
    </div>
  );
}
