// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';
import '../debate/ExportDropdown.css';

// Chat export formats: json + md + text + pdf (t/2782 parity; no package — chats have no assets).
const CHAT_EXPORT_OPTIONS: { format: string; label: string }[] = [
  { format: 'pdf', label: 'PDF' },
  { format: 'json', label: 'JSON' },
  { format: 'markdown', label: 'Markdown' },
  { format: 'text', label: 'Text' },
];

export function ChatExportDropdown({ onExport }: { onExport: (format: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (format: string) => { setOpen(false); onExport(format); };

  return (
    <div ref={ref} className="export-dropdown">
      <button
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        Export ▾
      </button>
      {open && (
        <div role="menu" className="export-dropdown-menu">
          {CHAT_EXPORT_OPTIONS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="btn export-dropdown-item"
              onClick={() => pick(format)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
