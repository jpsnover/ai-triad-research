// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useRef } from 'react';
import { useResilienceStatus, initResilienceUI, type ResilienceAlert } from '../../hooks/useResilienceStatus';
import { useFlag } from '../../hooks/useFeatureFlags';
import { initHealthProbe } from '../../bridge/healthProbe';
import './ResilienceBanner.css';

const TOAST_TTL_MS = 5000;
const MAX_TOASTS = 3;

function BannerIcon({ kind }: { kind: ResilienceAlert['kind'] }) {
  if (kind === 'degraded') {
    return (
      <svg className="resilience-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1l7 14H1L8 1zm0 3.5v5h0m0 1.5v1.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'server-down') {
    return (
      <svg className="resilience-banner-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <line x1="5" y1="5" x2="11" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="11" y1="5" x2="5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="resilience-banner-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" />
      <path d="M8 4v4l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function formatAlertMessage(alert: ResilienceAlert, isAdmin: boolean): string {
  if (isAdmin && alert.p95Ms != null && alert.baselineMs != null) {
    const threshold = Math.round(alert.baselineMs * 2);
    return `${alert.message} (p95: ${alert.p95Ms}ms, threshold: ${threshold}ms, baseline: ${alert.baselineMs}ms)`;
  }
  return alert.message;
}

export function ResilienceBanner() {
  const alerts = useResilienceStatus(s => s.alerts);
  const toasts = useResilienceStatus(s => s.toasts);
  const dismissToast = useResilienceStatus(s => s.dismissToast);
  const isAdmin = useFlag('permission-admin-features');
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => { initResilienceUI(); initHealthProbe(); }, []);

  useEffect(() => {
    const timers = timersRef.current;
    for (const t of toasts) {
      if (timers.has(t.id)) continue;
      const timer = setTimeout(() => {
        dismissToast(t.id);
        timers.delete(t.id);
      }, TOAST_TTL_MS);
      timers.set(t.id, timer);
    }
  }, [toasts, dismissToast]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const visibleToasts = toasts.slice(-MAX_TOASTS);

  return (
    <>
      {alerts.map(alert => (
        <div
          key={`${alert.kind}-${alert.category}`}
          className={`resilience-banner resilience-banner--${alert.kind}`}
          role="status"
          aria-live="polite"
        >
          <BannerIcon kind={alert.kind} />
          <span className="resilience-banner-text">{formatAlertMessage(alert, isAdmin)}</span>
        </div>
      ))}

      {visibleToasts.length > 0 && (
        <div className="resilience-toasts" role="status" aria-live="polite">
          {visibleToasts.map(t => (
            <div key={t.id} className="resilience-toast">
              <span className="resilience-toast-dot" aria-hidden="true" />
              <span className="resilience-toast-text">{t.message}</span>
              <button
                className="resilience-toast-dismiss"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
