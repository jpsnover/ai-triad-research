// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { CopyButton } from '../helpers';
import './ArtifactBlock.css';

interface ArtifactBlockProps {
  label: string;
  text: string;
  defaultOpen?: boolean;
}

export function ArtifactBlock({ label, text, defaultOpen = false }: ArtifactBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const lineCount = text.split('\n').length;

  return (
    <div className="artifact-block">
      <div
        className="artifact-block-header"
        onClick={() => setOpen(!open)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
      >
        <span className="artifact-block-chevron" data-open={open}>&#9654;</span>
        <span className="artifact-block-meta">{lineCount} lines &middot; {label}</span>
        <CopyButton text={text} />
      </div>
      {open && <pre className="artifact-block-content">{text}</pre>}
    </div>
  );
}
