// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api } from '@bridge';
import { useBreakpoint } from '../../hooks/useBreakpoint';

interface BottomNavProps {
  onOpenMore?: () => void;
}

export function BottomNav({ onOpenMore }: BottomNavProps) {
  const breakpoint = useBreakpoint();
  const {
    activeTab, setActiveTab,
    toolbarPanel, setToolbarPanel,
    clearSimilarSearch,
  } = useTaxonomyStore();

  if (breakpoint === 'desktop' || breakpoint === 'tablet-lg') return null;

  const tab = activeTab as string;
  const isDebateContext = tab === 'debate' || tab === 'chat';
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const isPovTab = ['accelerationist', 'safetyist', 'skeptic'].includes(tab);

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
          onClick={onOpenMore}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>
    </>
  );
}
