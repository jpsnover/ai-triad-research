// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Per-field click-to-edit primitive for the ConflictDetail redesign (t/1559 §4).
 *
 * Read mode shows the value (or a custom `renderRead`) as a focusable target;
 * Enter/Space enters edit mode. Edit mode buffers a local draft and commits via
 * `onCommit` only on Save/Enter — Escape/Cancel discards (buffer-then-commit, so
 * saving one field never touches others). No data-flow change: consumers pass an
 * `onCommit` that calls the existing `updateConflict`.
 *
 * Local to `conflict/` by design (one consumer today); promote to `shared/` only
 * when a second screen adopts click-to-edit (Shared Utility Rule, 2+ consumers).
 *
 * The read/edit modes are split into `EditableFieldRead` / `EditableFieldEdit`
 * props-only sub-components so this dispatcher stays under the complexity gate
 * (t/1919); the split is purely structural — behavior is unchanged.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export type EditableFieldType = 'text' | 'textarea' | 'date' | 'select';

export interface EditableFieldOption {
  value: string;
  label: string;
}

export interface EditableFieldProps {
  value: string;
  onCommit: (next: string) => void;
  type?: EditableFieldType;
  /** Options for `type="select"`. */
  options?: EditableFieldOption[];
  readOnly?: boolean;
  /** Shown in read mode when `value` is empty. */
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  /** Class applied to the read-mode target. */
  className?: string;
  /** Custom read-mode rendering (e.g. serif title / quoted assertion). */
  renderRead?: (value: string) => ReactNode;
}

export function EditableField({
  value,
  onCommit,
  type = 'text',
  options,
  readOnly = false,
  placeholder = '—',
  ariaLabel,
  rows = 3,
  className,
  renderRead,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const readRef = useRef<HTMLDivElement>(null);

  // Focus the editor when entering edit mode.
  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    if (readOnly) return;
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
    readRef.current?.focus();
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
    readRef.current?.focus();
  };

  if (!editing) {
    return (
      <EditableFieldRead
        readRef={readRef}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        className={className}
        renderRead={renderRead}
        onStart={startEditing}
      />
    );
  }

  return (
    <EditableFieldEdit
      editorRef={editorRef}
      type={type}
      draft={draft}
      rows={rows}
      ariaLabel={ariaLabel}
      options={options}
      onDraftChange={setDraft}
      onCommit={commit}
      onCancel={cancel}
    />
  );
}

interface EditableFieldReadProps {
  readRef: React.RefObject<HTMLDivElement | null>;
  value: string;
  readOnly: boolean;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
  renderRead?: (value: string) => ReactNode;
  onStart: () => void;
}

/** Read-mode target — focusable button that enters edit mode on click / Enter / Space. */
function EditableFieldRead({
  readRef,
  value,
  readOnly,
  placeholder,
  ariaLabel,
  className,
  renderRead,
  onStart,
}: EditableFieldReadProps) {
  const isEmpty = value.length === 0;
  return (
    <div
      ref={readRef}
      className={`editable-field-read${isEmpty ? ' editable-field-empty' : ''}${className ? ` ${className}` : ''}`}
      role={readOnly ? undefined : 'button'}
      tabIndex={readOnly ? undefined : 0}
      aria-label={readOnly ? undefined : (ariaLabel ?? 'Edit field')}
      onClick={onStart}
      onKeyDown={(e) => {
        if (readOnly) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStart(); }
      }}
    >
      {renderRead ? renderRead(value) : (isEmpty ? placeholder : value)}
    </div>
  );
}

interface EditableFieldEditProps {
  editorRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>;
  type: EditableFieldType;
  draft: string;
  rows: number;
  ariaLabel?: string;
  options?: EditableFieldOption[];
  onDraftChange: (next: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/** Edit-mode editor (textarea / select / input) with Cancel + Save actions. */
function EditableFieldEdit({
  editorRef,
  type,
  draft,
  rows,
  ariaLabel,
  options,
  onDraftChange,
  onCommit,
  onCancel,
}: EditableFieldEditProps) {
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    // Enter commits for single-line editors; textarea keeps Enter as newline.
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); onCommit(); }
  };

  return (
    <div className="editable-field-edit">
      {type === 'textarea' ? (
        <textarea
          ref={editorRef as React.RefObject<HTMLTextAreaElement>}
          className="editable-field-input"
          value={draft}
          rows={rows}
          aria-label={ariaLabel}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onEditorKeyDown}
        />
      ) : type === 'select' ? (
        <select
          ref={editorRef as React.RefObject<HTMLSelectElement>}
          className="editable-field-input"
          value={draft}
          aria-label={ariaLabel}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onEditorKeyDown}
        >
          {(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input
          ref={editorRef as React.RefObject<HTMLInputElement>}
          className="editable-field-input"
          type={type === 'date' ? 'date' : 'text'}
          value={draft}
          aria-label={ariaLabel}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onEditorKeyDown}
        />
      )}
      <div className="editable-field-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-sm btn-primary" onClick={onCommit}>Save</button>
      </div>
    </div>
  );
}
