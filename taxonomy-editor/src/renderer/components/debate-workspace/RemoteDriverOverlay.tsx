// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Banner text for a window whose debate another window drives. The driver is the main
 *  window when this is a pop-out, and a pop-out otherwise (t/3967: the pop-out used to
 *  tell the user to close a pop-out that did not exist). */
export function remoteDriverMessage(inPopout: boolean): string {
  return inPopout
    ? 'This debate is running in the main window. Controls will unlock when it finishes.'
    : 'Debate running in popout window. Controls are disabled here until the popout is closed.';
}

export function RemoteDriverOverlay({ show, inPopout }: { show: boolean; inPopout: boolean }) {
  if (!show) return null;
  return (
    <div className="debate-remote-overlay" role="status" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      padding: '12px 16px', margin: '0 8px 8px',
      background: 'var(--warning-bg, rgba(234,179,8,0.12))',
      border: '1px solid var(--warning-border, rgba(234,179,8,0.3))',
      borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-primary)',
    }}>
      <span style={{ fontSize: '1.1rem' }}>{inPopout ? '↙' : '↗'}</span>
      <span>{remoteDriverMessage(inPopout)}</span>
    </div>
  );
}
