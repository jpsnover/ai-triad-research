// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import { useUsernameStore, validateUsername } from '../hooks/useUsernameStore';

export function UsernamePromptDialog() {
  const { promptOpen, username, closePrompt, confirmPrompt } = useUsernameStore();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (promptOpen) {
      setValue(username ?? '');
      setError(null);
      // Focus after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [promptOpen, username]);

  if (!promptOpen) return null;

  const handleSubmit = () => {
    const validationError = validateUsername(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    confirmPrompt(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      closePrompt();
    }
  };

  return (
    <div className="dialog-overlay" onClick={closePrompt}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{username ? 'Change Username' : 'Set Username'}</h3>
        <p>
          {username
            ? 'Enter a new display name for your comments.'
            : 'Enter a display name for your comments. This will be saved for future sessions.'}
        </p>
        <div className={`form-group ${error ? 'has-error' : ''}`}>
          <input
            ref={inputRef}
            type="text"
            className="form-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Your name"
            maxLength={50}
          />
          {error && <div className="error-text">{error}</div>}
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={closePrompt}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            {username ? 'Update' : 'Set Username'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline badge that shows the current username. Click to change. */
export function UsernameBadge() {
  const { username, requestUsername } = useUsernameStore();
  if (!username) return null;

  return (
    <button
      className="username-badge"
      onClick={() => requestUsername()}
      title="Click to change username"
    >
      {username}
    </button>
  );
}
