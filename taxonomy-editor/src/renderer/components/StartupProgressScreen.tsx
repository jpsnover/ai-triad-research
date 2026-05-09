// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

interface CopyStatus {
  state: string;
  dir?: string;
  copied?: number;
  total?: number;
}

interface StartupProgressScreenProps {
  status: CopyStatus;
}

export function StartupProgressScreen({ status }: StartupProgressScreenProps) {
  const copied = status.copied ?? 0;
  const total = status.total ?? 0;
  const pct = total > 0 ? Math.round((copied / total) * 100) : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', padding: 32,
      background: 'var(--bg-primary, #1a1a2e)', color: 'var(--text-primary, #e0e0e0)',
    }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 8 }}>
          Loading data...
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #999)', marginBottom: 24 }}>
          {total > 0
            ? `Copying directory ${copied}/${total}${status.dir ? ` (${status.dir})` : ''}`
            : status.state === 'starting' ? 'Preparing data copy...' : 'Waiting for data...'}
        </p>

        {total > 0 && (
          <div style={{
            background: 'var(--bg-secondary, #16213e)',
            borderRadius: 6, height: 8, overflow: 'hidden',
            border: '1px solid var(--border-color, #333)',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: '#3b82f6',
              borderRadius: 6,
              transition: 'width 0.5s ease',
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
