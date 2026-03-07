// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useEffect } from 'react';

interface FieldHelpProps {
  text: string;
}

export function FieldHelp({ text }: FieldHelpProps) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  return (
    <span className="field-help" ref={ref}>
      <button
        className="field-help-btn"
        type="button"
        onClick={() => setShow(v => !v)}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        title={text}
      >
        ?
      </button>
      {show && (
        <div className="field-help-tooltip">{text}</div>
      )}
    </span>
  );
}
