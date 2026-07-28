// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { CSSProperties } from 'react';
import './StartupProgressScreen.css';

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
    <div className="startup-progress-screen">
      <div className="startup-progress-content">
        <h1 className="startup-progress-title">
          Loading data...
        </h1>
        <p className="startup-progress-desc">
          {total > 0
            ? `Copying directory ${copied}/${total}${status.dir ? ` (${status.dir})` : ''}`
            : status.state === 'starting' ? 'Preparing data copy...' : 'Waiting for data...'}
        </p>

        {total > 0 && (
          <div className="startup-progress-track">
            <div
              className="startup-progress-fill"
              /* eslint-disable-next-line local/no-inline-style -- pct is computed from live copy progress; width can't be a static class */
              style={{ '--startup-progress-pct': `${pct}%` } as CSSProperties}
            />
          </div>
        )}
      </div>
    </div>
  );
}
