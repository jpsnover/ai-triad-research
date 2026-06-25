// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback, useEffect, useState } from 'react';

export type DescriptionMode = 'formal' | 'plain';

const STORAGE_KEY = 'taxonomy-editor-description-mode';

function getStoredMode(): DescriptionMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'formal' || v === 'plain') return v;
  } catch { /* silent — localStorage may be unavailable */ }
  return 'plain';
}

export function useDescriptionMode(): [DescriptionMode, (mode: DescriptionMode) => void] {
  const [mode, setModeState] = useState<DescriptionMode>(getStoredMode);

  const setMode = useCallback((m: DescriptionMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* silent */ }
  }, []);

  return [mode, setMode];
}

export function resolveDescription(
  description?: string,
  plainDescription?: string | null,
  mode: DescriptionMode = 'plain',
): string {
  if (mode === 'formal' || !plainDescription) return description ?? '';
  return plainDescription;
}

interface DescriptionToggleProps {
  mode: DescriptionMode;
  onToggle: (mode: DescriptionMode) => void;
  hasPlainDescription: boolean;
}

export function DescriptionToggle({ mode, onToggle, hasPlainDescription }: DescriptionToggleProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.key === 'p') {
        e.preventDefault();
        onToggle(mode === 'formal' ? 'plain' : 'formal');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mode, onToggle]);

  return (
    <div className="description-toggle" role="radiogroup" aria-label="Description style">
      <button
        className={`description-toggle-btn${mode === 'formal' ? ' active' : ''}`}
        onClick={() => onToggle('formal')}
        role="radio"
        aria-checked={mode === 'formal'}
        title="Show formal (DOLCE) description"
      >
        Formal
      </button>
      <button
        className={`description-toggle-btn${mode === 'plain' ? ' active' : ''}`}
        onClick={() => onToggle('plain')}
        role="radio"
        aria-checked={mode === 'plain'}
        title={hasPlainDescription ? 'Show plain-language description (Alt+P)' : 'Plain version not available (Alt+P)'}
      >
        Plain
        {mode === 'plain' && !hasPlainDescription && (
          <span className="description-toggle-na" aria-label="not available">n/a</span>
        )}
      </button>
    </div>
  );
}
