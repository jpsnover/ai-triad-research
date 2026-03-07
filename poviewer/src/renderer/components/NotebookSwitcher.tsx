// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useAppStore } from '../store/useAppStore';

export default function NotebookSwitcher() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const setActiveNotebook = useAppStore(s => s.setActiveNotebook);

  return (
    <div className="notebook-switcher">
      <select
        value={activeNotebookId}
        onChange={e => setActiveNotebook(e.target.value)}
      >
        {notebooks.map(nb => (
          <option key={nb.id} value={nb.id}>
            {nb.name} ({nb.sources.length} source{nb.sources.length !== 1 ? 's' : ''})
          </option>
        ))}
      </select>
    </div>
  );
}
