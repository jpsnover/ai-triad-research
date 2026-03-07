// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import NotebookSwitcher from './NotebookSwitcher';
import TaxonomyDirSwitcher from './TaxonomyDirSwitcher';
import SourceList from './SourceList';
import TaxonomyManager from './TaxonomyManager';
import ThemeSwitcher from './ThemeSwitcher';
import AddSourceDialog from './AddSourceDialog';
import ApiKeyDialog from './ApiKeyDialog';
import ExportDialog from './ExportDialog';
import PromptEditor from './PromptEditor';

export default function SourcesPane() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const hasApiKey = useAnalysisStore(s => s.hasApiKey);
  const setHasApiKey = useAnalysisStore(s => s.setHasApiKey);

  useEffect(() => {
    if (window.electronAPI?.getApiKey) {
      window.electronAPI.getApiKey().then(key => {
        setHasApiKey(!!key);
      });
    }
  }, [setHasApiKey]);

  return (
    <>
      <div className="pane-header">
        <h2>Sources</h2>
        <div className="pane-header-actions">
          <button
            className={`apikey-btn ${hasApiKey ? 'has-key' : 'no-key'}`}
            onClick={() => setApiKeyDialogOpen(true)}
            title={hasApiKey ? 'API key configured' : 'Set API key'}
          >
            {hasApiKey ? '🔑' : '🔒'}
          </button>
          <button
            className="add-source-btn"
            onClick={() => setExportDialogOpen(true)}
            title="Export analysis"
          >
            &#8681;
          </button>
          <button
            className="add-source-btn"
            onClick={() => setPromptEditorOpen(true)}
            title="Edit prompts"
          >
            &#9998;
          </button>
          <button
            className="add-source-btn"
            onClick={() => setDialogOpen(true)}
            title="Add source"
          >
            +
          </button>
          <ThemeSwitcher />
        </div>
      </div>
      <NotebookSwitcher />
      <TaxonomyDirSwitcher />
      <SourceList />
      <TaxonomyManager />
      <AddSourceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <ApiKeyDialog open={apiKeyDialogOpen} onClose={() => setApiKeyDialogOpen(false)} />
      <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
      <PromptEditor open={promptEditorOpen} onClose={() => setPromptEditorOpen(false)} />
    </>
  );
}
