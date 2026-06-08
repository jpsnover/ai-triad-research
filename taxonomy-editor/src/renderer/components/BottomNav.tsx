// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { api } from '@bridge';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { SettingsDialog } from './SettingsDialog';

export function BottomNav() {
  const breakpoint = useBreakpoint();
  const {
    activeTab, setActiveTab,
    toolbarPanel, setToolbarPanel,
    clearSimilarSearch,
  } = useTaxonomyStore();
  const [showSettings, setShowSettings] = useState(false);

  if (breakpoint === 'desktop' || breakpoint === 'tablet-lg') return null;

  const isDebateContext = activeTab === 'debate' || activeTab === 'chat';
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const isPovTab = ['accelerationist', 'safetyist', 'skeptic'].includes(activeTab);

  const handleSearch = () => {
    if (toolbarPanel === 'search') {
      clearSimilarSearch();
      setToolbarPanel(null);
    } else {
      setToolbarPanel('search');
    }
  };

  const handleTaxonomy = () => {
    if (toolbarPanel !== null) setToolbarPanel(null);
    useTaxonomyStore.setState({ relatedNodeId: null, selectedEdge: null });
    if (['situations', 'conflicts', 'cruxes', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab)) {
      setActiveTab('accelerationist');
    }
  };

  const switchTab = (tab: 'debate' | 'chat') => {
    useTaxonomyStore.setState({ relatedNodeId: null, selectedEdge: null });
    setToolbarPanel(null);
    setActiveTab(tab);
  };

  return (
    <>
      <nav className="bottom-nav" role="navigation" aria-label="Bottom navigation">
        <button
          className={`bottom-nav-item${toolbarPanel === 'search' ? ' active' : ''}`}
          onClick={handleSearch}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="bottom-nav-label">Search</span>
        </button>

        {isDebateContext ? (
          <>
            <button
              className={`bottom-nav-item${activeTab === 'debate' ? ' active' : ''}`}
              onClick={() => switchTab('debate')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="bottom-nav-label">Debate</span>
            </button>
            <button
              className="bottom-nav-item"
              onClick={() => void api.openChatWindow()}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span className="bottom-nav-label">Chat</span>
            </button>
          </>
        ) : (
          <>
            <button
              className={`bottom-nav-item${isPovTab && toolbarPanel === null ? ' active' : ''}`}
              onClick={handleTaxonomy}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span className="bottom-nav-label">Taxonomy</span>
            </button>
            {!isPhone && (
              <button
                className={`bottom-nav-item${activeTab === 'debate' ? ' active' : ''}`}
                onClick={() => switchTab('debate')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="bottom-nav-label">Debate</span>
              </button>
            )}
          </>
        )}

        <button
          className="bottom-nav-item"
          onClick={() => setShowSettings(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="bottom-nav-label">Settings</span>
        </button>
      </nav>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}
