// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import './BriefTimeoutToast.css';

interface BriefTimeoutToastProps {
  speakerLabel: string;
  attempt: number;
  maxAttempts: number;
  currentModel: string;
  onSwitchModel: () => void;
  onDismiss: () => void;
}

export function BriefTimeoutToast({
  speakerLabel, attempt, maxAttempts, currentModel, onSwitchModel, onDismiss,
}: BriefTimeoutToastProps) {
  return (
    <div className="brief-timeout-toast" role="status" aria-live="polite">
      <p className="brief-timeout-toast-msg">
        <strong>{speakerLabel}</strong> brief is taking longer than expected
        {maxAttempts > 1 && <span className="brief-timeout-toast-attempt"> ({attempt}/{maxAttempts})</span>}
        {currentModel && <> — <code className="brief-timeout-toast-model">{currentModel}</code></>}
      </p>
      <div className="brief-timeout-toast-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={onSwitchModel}>
          Switch model
        </button>
        <button type="button" className="btn btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
