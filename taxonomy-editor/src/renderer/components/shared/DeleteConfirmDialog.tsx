// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

interface DeleteConfirmDialogProps {
  itemLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({ itemLabel, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Delete Node</h3>
        <p>
          Are you sure you want to delete <strong>{itemLabel || '(untitled)'}</strong>?
          This action cannot be undone until you save.
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
