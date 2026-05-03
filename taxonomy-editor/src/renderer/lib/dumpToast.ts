// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Lightweight toast notification for flight recorder dumps.
 * Pure DOM — no React dependency so it can fire from flightRecorderInit.ts
 * (which runs before React mounts).
 */

const TOAST_DURATION_MS = 8000;
const CONTAINER_ID = 'flight-recorder-toast-container';

function getOrCreateContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    Object.assign(container.style, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '99999',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
    });
    document.body.appendChild(container);
  }
  return container;
}

const BTN_STYLE: Partial<CSSStyleDeclaration> = {
  background: 'var(--bg-tertiary, #313244)',
  color: 'var(--text-primary, #cdd6f4)',
  border: '1px solid var(--border-color, #45475a)',
  borderRadius: '4px',
  padding: '3px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans, sans-serif)',
};

/**
 * Show a toast notification for a flight recorder dump.
 *
 * - Electron: file path + Copy + Open buttons
 * - Web/Azure: clickable download link
 */
export function showDumpToast(opts: {
  filename: string;
  filePath: string;
  isWeb: boolean;
  onCopy?: () => void;
  onOpen?: () => void;
}): void {
  const container = getOrCreateContainer();

  const toast = document.createElement('div');
  Object.assign(toast.style, {
    position: 'relative',
    background: 'var(--bg-secondary, #1e1e2e)',
    color: 'var(--text-primary, #cdd6f4)',
    border: '1px solid var(--border-color, #45475a)',
    borderRadius: '6px',
    padding: '10px 14px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono, monospace)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    pointerEvents: 'auto',
    maxWidth: '420px',
    opacity: '0',
    transform: 'translateY(10px)',
    transition: 'opacity 0.2s, transform 0.2s',
  });

  const title = document.createElement('div');
  title.textContent = 'Flight recorder dump saved';
  Object.assign(title.style, {
    fontWeight: '600',
    marginBottom: '4px',
    color: 'var(--accent-color, #89b4fa)',
  });
  toast.appendChild(title);

  if (opts.isWeb) {
    // Web mode: clickable download link
    const link = document.createElement('a');
    link.textContent = opts.filename;
    link.href = `/api/flight-recorder/download/${encodeURIComponent(opts.filename)}`;
    link.download = opts.filename;
    Object.assign(link.style, {
      color: 'var(--accent-color, #89b4fa)',
      textDecoration: 'underline',
      cursor: 'pointer',
      wordBreak: 'break-all',
    });
    toast.appendChild(link);
  } else {
    // Electron mode: file path + Copy + Open buttons
    const pathEl = document.createElement('div');
    pathEl.textContent = opts.filePath;
    Object.assign(pathEl.style, {
      wordBreak: 'break-all',
      opacity: '0.8',
      marginBottom: '6px',
    });
    toast.appendChild(pathEl);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '6px' });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    Object.assign(copyBtn.style, BTN_STYLE);
    copyBtn.onclick = () => {
      opts.onCopy?.();
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    };
    btnRow.appendChild(copyBtn);

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open';
    Object.assign(openBtn.style, BTN_STYLE);
    openBtn.onclick = () => opts.onOpen?.();
    btnRow.appendChild(openBtn);

    toast.appendChild(btnRow);
  }

  // Dismiss button
  const dismiss = document.createElement('button');
  dismiss.textContent = '\u00d7';
  Object.assign(dismiss.style, {
    position: 'absolute',
    top: '4px',
    right: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted, #6c7086)',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: '1',
  });
  dismiss.onclick = () => removeToast(toast);
  toast.appendChild(dismiss);

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  // Auto-dismiss
  setTimeout(() => removeToast(toast), TOAST_DURATION_MS);
}

function removeToast(toast: HTMLElement): void {
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(10px)';
  setTimeout(() => toast.remove(), 200);
}
