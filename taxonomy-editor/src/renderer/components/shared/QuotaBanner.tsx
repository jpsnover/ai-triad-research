// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useQuotaWarning, type QuotaLevel } from '../../hooks/useQuotaWarning';
import './QuotaBanner.css';

function QuotaIcon({ level }: { level: QuotaLevel }) {
  if (level === 'error') {
    return (
      <svg className="quota-banner-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
        <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (level === 'warning') {
    return (
      <svg className="quota-banner-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1l7 14H1L8 1z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
        <line x1="8" y1="6" x2="8" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8" cy="12" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="quota-banner-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="4.5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function QuotaBanner() {
  const warning = useQuotaWarning(s => s.warning);
  const dismiss = useQuotaWarning(s => s.dismiss);

  if (!warning || warning.dismissedAt) return null;

  return (
    <div
      className={`quota-banner quota-banner--${warning.level}`}
      role="status"
      aria-live="polite"
    >
      <QuotaIcon level={warning.level} />
      <span className="quota-banner-text">{warning.message}</span>
      {warning.level !== 'error' && (
        <button
          className="quota-banner-dismiss"
          onClick={dismiss}
          aria-label="Dismiss quota warning"
        >
          &times;
        </button>
      )}
    </div>
  );
}
