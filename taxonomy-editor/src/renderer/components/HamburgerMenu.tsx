// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import { api } from '@bridge';
import { HelpDialog } from './HelpDialog';
import { SettingsDialog } from './SettingsDialog';

interface AuthInfo { user: string; anonymous: boolean; idp: string }

function useAuthStatus(): AuthInfo | null {
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(setAuth).catch(() => {});
  }, []);
  return auth;
}

function AuthSection() {
  const auth = useAuthStatus();
  if (!auth || import.meta.env.VITE_TARGET !== 'web') return null;
  return (
    <>
      <div className="hamburger-divider" />
      <div className="hamburger-section">Account</div>
      {auth.anonymous ? (
        <>
          <a className="hamburger-item" href="/.auth/login/github" style={{ textDecoration: 'none', color: 'inherit' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>Sign in with GitHub</span>
          </a>
          <a className="hamburger-item" href="/.auth/login/google" style={{ textDecoration: 'none', color: 'inherit' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
            <span>Sign in with Google</span>
          </a>
        </>
      ) : (
        <>
          <div className="hamburger-item" style={{ cursor: 'default', opacity: 0.8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <span>{auth.user}{auth.idp ? ` (${auth.idp})` : ''}</span>
          </div>
          <a className="hamburger-item" href="/.auth/logout" style={{ textDecoration: 'none', color: 'inherit' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            <span>Sign out</span>
          </a>
        </>
      )}
    </>
  );
}

interface HamburgerMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

type ToolbarPanel = 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | 'calibration';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  action: () => void;
}

export function HamburgerMenu({ isOpen, onClose }: HamburgerMenuProps) {
  const {
    toolbarPanel, setToolbarPanel,
    activeTab, setActiveTab,
    selectedNodeId,
    clearSimilarSearch,
    showRelatedEdges,
    attributeFilter, runAttributeFilter,
    clearAttributeFilter,
    attributeInfo, showAttributeInfo,
    clearAttributeInfo,
  } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef({ startX: 0, currentX: 0, swiping: false });

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const clearCurrentPanel = useCallback(() => {
    if (toolbarPanel === 'search') clearSimilarSearch();
    else if (toolbarPanel === 'related') showRelatedEdges(null);
    else if (toolbarPanel === 'attrFilter') clearAttributeFilter();
    else if (toolbarPanel === 'attrInfo') clearAttributeInfo();
  }, [toolbarPanel, clearSimilarSearch, showRelatedEdges, clearAttributeFilter, clearAttributeInfo]);

  const switchTab = useCallback((tab: 'situations' | 'conflicts' | 'cruxes' | 'debate' | 'chat' | 'summaries' | 'validation') => {
    clearCurrentPanel();
    useTaxonomyStore.setState({ relatedNodeId: null, selectedEdge: null });
    setToolbarPanel(null);
    setActiveTab(tab);
  }, [clearCurrentPanel, setToolbarPanel, setActiveTab]);

  const toggle = useCallback((panel: ToolbarPanel) => {
    if (toolbarPanel === panel) {
      clearCurrentPanel();
      setToolbarPanel(null);
    } else {
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
  }, [toolbarPanel, clearCurrentPanel, setToolbarPanel, selectedNodeId, showRelatedEdges, attributeFilter, runAttributeFilter, attributeInfo, showAttributeInfo]);

  const act = useCallback((action: () => void) => {
    action();
    onClose();
  }, [onClose]);

  // Swipe-left to dismiss
  const onTouchStart = (e: React.TouchEvent) => {
    touchRef.current = { startX: e.touches[0].clientX, currentX: e.touches[0].clientX, swiping: true };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current.swiping) return;
    touchRef.current.currentX = e.touches[0].clientX;
    const delta = touchRef.current.currentX - touchRef.current.startX;
    if (delta < 0 && drawerRef.current) {
      drawerRef.current.style.transform = `translateX(${delta}px)`;
    }
  };
  const onTouchEnd = () => {
    if (!touchRef.current.swiping) return;
    const delta = touchRef.current.currentX - touchRef.current.startX;
    touchRef.current.swiping = false;
    if (drawerRef.current) drawerRef.current.style.transform = '';
    if (delta < -80) onClose();
  };

  const isPovTab = ['accelerationist', 'safetyist', 'skeptic'].includes(activeTab);

  const browseItems: MenuItem[] = [
    {
      id: 'taxonomy', label: 'Taxonomy',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
      active: isPovTab && toolbarPanel === null,
      action: () => {
        clearCurrentPanel();
        setToolbarPanel(null);
        if (['situations', 'conflicts', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab)) setActiveTab('accelerationist');
      },
    },
    {
      id: 'situations', label: 'Situations',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
      active: activeTab === 'situations' && toolbarPanel === null,
      action: () => switchTab('situations'),
    },
    {
      id: 'conflicts', label: 'Conflicts',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
      active: activeTab === 'conflicts' && toolbarPanel === null,
      action: () => switchTab('conflicts'),
    },
    {
      id: 'cruxes', label: 'Cruxes',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
      active: activeTab === 'cruxes' && toolbarPanel === null,
      action: () => switchTab('cruxes'),
    },
    {
      id: 'summaries', label: 'Summaries',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="14" y2="11" /></svg>,
      active: activeTab === 'summaries' && toolbarPanel === null,
      action: () => switchTab('summaries'),
    },
    {
      id: 'validation', label: 'Validation',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>,
      active: activeTab === 'validation' && toolbarPanel === null,
      action: () => switchTab('validation'),
    },
  ];

  const communicateItems: MenuItem[] = [
    {
      id: 'debate', label: 'Debate',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
      active: activeTab === 'debate' && toolbarPanel === null,
      action: () => switchTab('debate'),
    },
    {
      id: 'chat', label: 'Chat',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>,
      active: false,
      action: () => void api.openChatWindow(),
    },
  ];

  const analyzeItems: MenuItem[] = [
    {
      id: 'search', label: 'Search',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>,
      active: toolbarPanel === 'search',
      action: () => toggle('search'),
    },
    {
      id: 'lineage', label: 'Intellectual Lineage',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18" /><path d="M8 7l4-4 4 4" /><path d="M5 12h14" /><path d="M8 17l-3 3" /><path d="M16 17l3 3" /></svg>,
      active: toolbarPanel === 'lineage',
      action: () => toggle('lineage'),
    },
    {
      id: 'edges', label: 'Edge Browser',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="3" /><circle cx="19" cy="12" r="3" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
      active: toolbarPanel === 'edges',
      action: () => toggle('edges'),
    },
    {
      id: 'policyAlignment', label: 'Policy Alignment',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>,
      active: toolbarPanel === 'policyAlignment',
      action: () => toggle('policyAlignment'),
    },
    {
      id: 'policyDashboard', label: 'Policy Dashboard',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></svg>,
      active: toolbarPanel === 'policyDashboard',
      action: () => toggle('policyDashboard'),
    },
    {
      id: 'fallacy', label: 'Possible Fallacies',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M3.6 15.4L10.3 4.6a2 2 0 0 1 3.4 0l6.7 10.8A2 2 0 0 1 18.7 19H5.3a2 2 0 0 1-1.7-3.6z" /></svg>,
      active: toolbarPanel === 'fallacy',
      action: () => toggle('fallacy'),
    },
    {
      id: 'vocabulary', label: 'Vocabulary',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M8 7h8" /><path d="M8 11h6" /><path d="M8 15h4" /></svg>,
      active: toolbarPanel === 'vocabulary',
      action: () => toggle('vocabulary'),
    },
    {
      id: 'calibration', label: 'Calibration',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" /></svg>,
      active: toolbarPanel === 'calibration',
      action: () => toggle('calibration'),
    },
  ];

  const systemItems: MenuItem[] = [
    {
      id: 'console', label: 'Console',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>,
      active: toolbarPanel === 'console',
      action: () => toggle('console'),
    },
    {
      id: 'prompts', label: 'Prompts',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
      active: toolbarPanel === 'prompts',
      action: () => toggle('prompts'),
    },
  ];

  const renderItem = (item: MenuItem) => (
    <button
      key={item.id}
      className={`hamburger-item${item.active ? ' active' : ''}`}
      onClick={() => act(item.action)}
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );

  return (
    <>
      <div
        className={`hamburger-backdrop${isOpen ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={drawerRef}
        className={`hamburger-drawer${isOpen ? ' open' : ''}`}
        role="dialog"
        aria-label="Navigation menu"
        aria-modal="true"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="hamburger-header">
          <button className="hamburger-close" onClick={onClose} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span className="hamburger-title">Taxonomy Editor</span>
        </div>

        <div className="hamburger-body">
          <div className="hamburger-section">Browse</div>
          {browseItems.map(renderItem)}

          <div className="hamburger-section">Communicate</div>
          {communicateItems.map(renderItem)}

          <div className="hamburger-section">Analyze</div>
          {analyzeItems.map(renderItem)}

          <div className="hamburger-divider" />
          {systemItems.map(renderItem)}

          <AuthSection />

          <div className="hamburger-divider" />
          <button
            className="hamburger-item"
            onClick={() => { setShowHelp(true); onClose(); }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Help</span>
          </button>
          <button
            className="hamburger-item"
            onClick={() => { setShowSettings(true); onClose(); }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </div>

      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  );
}
