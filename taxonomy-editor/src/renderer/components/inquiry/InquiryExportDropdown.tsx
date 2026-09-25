// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Inquiry export dropdown (t/3624) — mirrors ChatExportDropdown.tsx exactly. PDF is
// browser print-to-PDF (no library), JSON/MD are Blob+anchor downloads — see
// web-bridge.ts's exportInquiryToFile for the actual format logic.

import { useState, useRef, useEffect } from 'react';
import '../debate/ExportDropdown.css';

const INQUIRY_EXPORT_OPTIONS: { format: 'pdf' | 'json' | 'markdown'; label: string }[] = [
  { format: 'pdf', label: 'PDF' },
  { format: 'json', label: 'JSON' },
  { format: 'markdown', label: 'Markdown' },
];

export function InquiryExportDropdown({ onExport }: { onExport: (format: 'pdf' | 'json' | 'markdown') => void }) {
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

  const pick = (format: 'pdf' | 'json' | 'markdown') => { setOpen(false); onExport(format); };

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
          {INQUIRY_EXPORT_OPTIONS.map(({ format, label }) => (
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
