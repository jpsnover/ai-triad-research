// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { HelpDialog } from './HelpDialog';
import { SettingsDialog } from './SettingsDialog';

type ToolbarPanel = 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'console';

export function Toolbar() {
  const {
    toolbarPanel, setToolbarPanel,
    selectedNodeId,
    clearSimilarSearch, getLabelForId,
    showRelatedEdges,
    clearAttributeFilter,
    clearAttributeInfo,
    previousView, navigateBack,
  } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Escape key navigates back
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previousView && !showHelp && !showSettings) {
        const target = e.target as HTMLElement;
        // Don't intercept Escape in inputs (they use it to blur)
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        e.preventDefault();
        navigateBack();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previousView, navigateBack, showHelp, showSettings]);

  const clearCurrentPanel = () => {
    if (toolbarPanel === 'search') clearSimilarSearch();
    else if (toolbarPanel === 'related') showRelatedEdges(null);
    else if (toolbarPanel === 'attrFilter') clearAttributeFilter();
    else if (toolbarPanel === 'attrInfo') clearAttributeInfo();
  };

  const toggle = (panel: ToolbarPanel) => {
    if (toolbarPanel === panel) {
      // Close the panel
      clearCurrentPanel();
      setToolbarPanel(null);
    } else {
      // Open the panel — for related, use the currently selected node
      if (panel === 'related' && selectedNodeId) {
        showRelatedEdges(selectedNodeId);
      } else {
        setToolbarPanel(panel);
      }
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-top">
        {previousView && (
          <>
            <button
              className="toolbar-icon toolbar-back"
              onClick={navigateBack}
              data-tooltip="Back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <div className="toolbar-separator" />
          </>
        )}
        <button
          className={`toolbar-icon${toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => {
            clearCurrentPanel();
            setToolbarPanel(null);
          }}
          data-tooltip="Taxonomy"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        <div className="toolbar-separator" />
        <button
          className={`toolbar-icon${toolbarPanel === 'search' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('search')}
          data-tooltip="Search"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          className={`toolbar-icon${toolbarPanel === 'related' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('related')}
          data-tooltip="Related Edges"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="3" />
            <circle cx="19" cy="12" r="3" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>
        <button
          className={`toolbar-icon${toolbarPanel === 'attrFilter' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('attrFilter')}
          data-tooltip="Attribute Filter"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
        <button
          className={`toolbar-icon${toolbarPanel === 'attrInfo' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('attrInfo')}
          data-tooltip="Attribute Info"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
        <button
          className={`toolbar-icon${toolbarPanel === 'lineage' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('lineage')}
          data-tooltip="Intellectual Lineage"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18" />
            <path d="M8 7l4-4 4 4" />
            <path d="M5 12h14" />
            <path d="M8 17l-3 3" />
            <path d="M16 17l3 3" />
          </svg>
        </button>
      </div>
      <div className="toolbar-bottom">
        <button
          className={`toolbar-icon${toolbarPanel === 'console' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('console')}
          data-tooltip="Console"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </button>
        <button
          className="toolbar-icon"
          onClick={() => setShowHelp(true)}
          data-tooltip="Help"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <button
          className="toolbar-icon"
          onClick={() => setShowSettings(true)}
          data-tooltip="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
