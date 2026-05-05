// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { HelpDialog } from './HelpDialog';
import { SettingsDialog } from './SettingsDialog';

type ToolbarPanel = 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | 'calibration';

export function Toolbar() {
  const {
    toolbarPanel, setToolbarPanel,
    activeTab, setActiveTab,
    selectedNodeId,
    clearSimilarSearch, getLabelForId,
    showRelatedEdges,
    attributeFilter, runAttributeFilter,
    clearAttributeFilter,
    attributeInfo, showAttributeInfo,
    clearAttributeInfo,
    previousView, navigateBack,
  } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close "More" popover on outside click
  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showMore]);

  const morePanels: ToolbarPanel[] = ['edges', 'policyAlignment', 'policyDashboard', 'fallacy', 'vocabulary', 'calibration'];
  const moreHasActive = morePanels.includes(toolbarPanel as ToolbarPanel);

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

  const switchTab = (tab: 'situations' | 'conflicts' | 'cruxes' | 'debate' | 'chat' | 'summaries') => {
    clearCurrentPanel();
    // NodeDetail's Related tab sets relatedNodeId without setting toolbarPanel.
    // Clear it so the next tab's effects don't re-open a Related view on a
    // leftover node id.
    useTaxonomyStore.setState({ relatedNodeId: null, selectedEdge: null });
    setToolbarPanel(null);
    setActiveTab(tab);
  };

  const toggle = (panel: ToolbarPanel) => {
    if (toolbarPanel === panel) {
      // Close the panel
      clearCurrentPanel();
      setToolbarPanel(null);
    } else {
      // Open the panel — some panels need initialization
      if (panel === 'related' && selectedNodeId) {
        showRelatedEdges(selectedNodeId);
      } else if (panel === 'attrFilter' && !attributeFilter) {
        runAttributeFilter('epistemic_type', 'empirical_claim');
      } else if (panel === 'attrInfo' && !attributeInfo) {
        showAttributeInfo('epistemic_type', 'empirical_claim');
      } else {
        setToolbarPanel(panel);
      }
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-top">
        {previousView && toolbarPanel !== null && activeTab !== 'debate' && (
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
        {/* Search */}
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
        <div className="toolbar-separator" />
        {/* Taxonomy */}
        <button
          className={`toolbar-icon${toolbarPanel === null && !['situations', 'conflicts', 'cruxes', 'debate', 'chat', 'summaries'].includes(activeTab) ? ' toolbar-icon-active' : ''}`}
          onClick={() => {
            clearCurrentPanel();
            setToolbarPanel(null);
            if (['situations', 'conflicts', 'debate', 'chat', 'summaries'].includes(activeTab)) {
              setActiveTab('accelerationist');
            }
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
        {/* Situations */}
        <button
          className={`toolbar-icon${activeTab === 'situations' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('situations')}
          data-tooltip="Situations"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {/* Conflicts */}
        <button
          className={`toolbar-icon${activeTab === 'conflicts' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('conflicts')}
          data-tooltip="Conflicts"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        {/* Cruxes */}
        <button
          className={`toolbar-icon${activeTab === 'cruxes' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('cruxes')}
          data-tooltip="Cruxes"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        </button>
        {/* Summaries */}
        <button
          className={`toolbar-icon${activeTab === 'summaries' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('summaries')}
          data-tooltip="Summaries"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <line x1="8" y1="7" x2="16" y2="7" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <div className="toolbar-separator" />
        {/* Intellectual Lineage */}
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
        {/* More (overflow: Edge Browser, Policy Alignment, Policy Dashboard, Possible Fallacies) */}
        <div className="toolbar-more-wrap" ref={moreRef}>
          <button
            className={`toolbar-icon${moreHasActive || showMore ? ' toolbar-icon-active' : ''}`}
            onClick={() => setShowMore(v => !v)}
            data-tooltip="More tools"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {showMore && (
            <div className="toolbar-more-popover" role="menu">
              <button
                className={`toolbar-more-item${toolbarPanel === 'edges' ? ' active' : ''}`}
                onClick={() => { toggle('edges'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="3" />
                  <circle cx="19" cy="12" r="3" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>Edge Browser</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'policyAlignment' ? ' active' : ''}`}
                onClick={() => { toggle('policyAlignment'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span>Policy Alignment</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'policyDashboard' ? ' active' : ''}`}
                onClick={() => { toggle('policyDashboard'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="12" width="4" height="9" rx="1" />
                  <rect x="10" y="7" width="4" height="14" rx="1" />
                  <rect x="17" y="3" width="4" height="18" rx="1" />
                </svg>
                <span>Policy Dashboard</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'fallacy' ? ' active' : ''}`}
                onClick={() => { toggle('fallacy'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M3.6 15.4L10.3 4.6a2 2 0 0 1 3.4 0l6.7 10.8A2 2 0 0 1 18.7 19H5.3a2 2 0 0 1-1.7-3.6z" />
                </svg>
                <span>Possible Fallacies</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'vocabulary' ? ' active' : ''}`}
                onClick={() => { toggle('vocabulary'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M8 7h8" />
                  <path d="M8 11h6" />
                  <path d="M8 15h4" />
                </svg>
                <span>Vocabulary</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'calibration' ? ' active' : ''}`}
                onClick={() => { toggle('calibration'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18" />
                  <path d="M7 16l4-8 4 4 4-6" />
                </svg>
                <span>Calibration</span>
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-separator" />
        {/* Debates */}
        <button
          className={`toolbar-icon${activeTab === 'debate' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('debate')}
          data-tooltip="Debate"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        {/* Chat */}
        <button
          className={`toolbar-icon${activeTab === 'chat' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('chat')}
          data-tooltip="Chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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
          className={`toolbar-icon${toolbarPanel === 'prompts' ? ' toolbar-icon-active' : ''}`}
          onClick={() => toggle('prompts')}
          data-tooltip="Prompts"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
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
