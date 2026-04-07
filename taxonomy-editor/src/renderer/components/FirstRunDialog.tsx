// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { api } from '@bridge';

interface FirstRunDialogProps {
  dataRoot: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function FirstRunDialog({ dataRoot, onComplete, onSkip }: FirstRunDialogProps) {
  const [status, setStatus] = useState<'prompt' | 'downloading' | 'done' | 'error'>('prompt');
  const [message, setMessage] = useState('');

  const handleDownload = async () => {
    setStatus('downloading');
    setMessage('Cloning research data from GitHub...');
    try {
      const result = await api.cloneDataRepo(dataRoot);
      if (result.success) {
        setStatus('done');
        setMessage('Data downloaded successfully!');
        setTimeout(onComplete, 1500);
      } else {
        setStatus('error');
        setMessage(result.message);
      }
    } catch (err) {
      setStatus('error');
      setMessage(String(err));
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog first-run-dialog">
        <div className="first-run-icon">&#128218;</div>
        <h2>Welcome to AI Triad</h2>

        {status === 'prompt' && (
          <>
            <p className="first-run-desc">
              The Taxonomy Editor needs research data to operate. This includes taxonomy definitions,
              source documents, summaries, and conflict analyses (~410 MB).
            </p>
            <div className="first-run-path">
              <span className="first-run-path-label">Download to:</span>
              <code className="first-run-path-value">{dataRoot}</code>
            </div>
            <div className="first-run-actions">
              <button className="btn btn-primary first-run-btn" onClick={handleDownload}>
                Download Data
              </button>
              <button className="btn first-run-btn" onClick={onSkip}>
                Skip for Now
              </button>
            </div>
            <p className="first-run-hint">
              You can download the data later from Settings or by running
              <code>Install-AITriadData</code> in PowerShell.
            </p>
          </>
        )}

        {status === 'downloading' && (
          <div className="first-run-progress">
            <div className="first-run-spinner" />
            <p>{message}</p>
            <p className="first-run-hint">This may take a few minutes depending on your connection.</p>
          </div>
        )}

        {status === 'done' && (
          <div className="first-run-progress">
            <div className="first-run-check">&#10003;</div>
            <p>{message}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="first-run-progress">
            <p className="first-run-error">{message}</p>
            <div className="first-run-actions">
              <button className="btn btn-primary first-run-btn" onClick={handleDownload}>
                Retry
              </button>
              <button className="btn first-run-btn" onClick={onSkip}>
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
