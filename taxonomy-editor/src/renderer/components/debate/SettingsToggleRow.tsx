// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/** Checkbox row used by the New Debate settings dialog. Extracted to keep NewDebateDialog
 *  under the max-lines ceiling. */
export function SettingsToggleRow({ checked, onChange, name, help }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  name: string;
  help: string;
}) {
  return (
    <label className="ndd-settings-toggle-row">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <div>
        <span className="ndd-toggle-name">{name}</span>
        <span className="ndd-step-help">{help}</span>
      </div>
    </label>
  );
}
