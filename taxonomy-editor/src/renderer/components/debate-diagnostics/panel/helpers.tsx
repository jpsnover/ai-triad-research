// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef } from 'react';
import { api } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { POVER_INFO } from '../../../types/debate';
import type { SpeakerId } from '../../../types/debate';

export function speakerLabel(speaker: SpeakerId | 'system' | 'document' | 'moderator'): string {
  if (speaker === 'system') return 'System';
  if (speaker === 'moderator') return 'Moderator';
  if (speaker === 'user') return 'You';
  if (speaker === 'document') return 'Document';
  return POVER_INFO[speaker as Exclude<SpeakerId, 'user'>]?.label || speaker;
}

function CopyButton({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const text = targetRef.current?.innerText ?? '';
        void navigator.clipboard.writeText(text).catch((err) => {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'diagnostics-panel', level: 'warn', message: 'Clipboard write failed, using Electron fallback', error: { name: (err as Error).name ?? 'Error', message: String(err) } });
          void api.clipboardWriteText(text);
        });
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="diag-copy-btn"
      title="Copy section content to clipboard"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <div className="diag-section">
      <div className="diag-section-header-row">
        <button className="diag-section-header" onClick={() => setOpen(!open)}>
          <span>{open ? '▼' : '▶'}</span> {title}
        </button>
        {open && <CopyButton targetRef={bodyRef} />}
      </div>
      {open && <div className="diag-section-body" ref={bodyRef}>{children}</div>}
    </div>
  );
}
