// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useRef, useCallback, useEffect, Fragment } from 'react';
import { Shield, X } from 'lucide-react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api, isElectronMode } from '@bridge';
import { HelpDialog } from '../settings/HelpDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { FeedbackPopover } from './FeedbackPopover';
import { useAuthStatus } from '../../hooks/useAuthStatus';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useFlag, useFeatureFlagStore } from '../../hooks/useFeatureFlags';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import {
  NAV_ITEMS, getVisibleNavItems, getSecondaryByGroup,
  type NavItem, type NavAction, type NavGroup,
} from '../../data/navConfig';
import type { TabId } from '../../types/taxonomy';
import './HamburgerMenu.css';

function AuthSection() {
  const auth = useAuthStatus();
  if (!auth || import.meta.env.VITE_TARGET !== 'web') return null;
  return (
    <>
      <div className="hamburger-divider" />
      {auth.anonymous ? (
        <>
          <a className="hamburger-item hamburger-link" href="/api/auth/fresh-login/github">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
            <span>Sign in with GitHub</span>
          </a>
          <a className="hamburger-item hamburger-link" href="/api/auth/fresh-login/google">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
            <span>Sign in with Google</span>
          </a>
        </>
      ) : (
        <>
          <div className="hamburger-item hamburger-item-static">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            <span>{auth.user}{auth.idp ? ` (${auth.idp})` : ''}</span>
          </div>
          <a className="hamburger-item hamburger-link" href="/api/auth/logout"
            onClick={() => getGlobalRecorder()?.record({ type: 'auth.logout_initiated', component: 'auth', level: 'info', message: 'User initiated logout', data: { target: '/api/auth/logout', source: 'hamburger-menu' } })}>
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

const GROUP_LABELS: Record<NavGroup, string> = { browse: 'Browse', analysis: 'Analysis', tools: 'Tools' };

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
    loadAll, loading,
  } = useTaxonomyStore();
  const breakpoint = useBreakpoint();
  const adminFeatures = useFlag('permission-admin-features');
  // Whole flag record → navCtx (drift-proof; see Toolbar/t/2641). Below at navCtx.
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

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

  const switchTab = useCallback((tab: TabId) => {
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
  const isPhone = breakpoint === 'phone' || breakpoint === 'phone-lg';
  const isDebateContext = activeTab === 'debate' || activeTab === 'chat';

  // Items already visible in BottomNav — exclude from this menu
  const bottomNavIds = new Set<string>(['search']);
  if (isDebateContext) {
    bottomNavIds.add('debate');
    bottomNavIds.add('chat');
  } else {
    bottomNavIds.add('taxonomy');
    if (!isPhone) bottomNavIds.add('debate');
  }

  // NavConfig-driven items
  const allFlags = useFeatureFlagStore(s => s.flags); // whole record → no nav-gate flag can drift (t/2641)
  const navCtx = { flags: allFlags, isAdmin: adminFeatures };
  const visibleItems = getVisibleNavItems(NAV_ITEMS, navCtx);
  const primaryNavItems = visibleItems.filter(i => i.tier === 'primary' && !bottomNavIds.has(i.id));
  const secondaryGroups = getSecondaryByGroup(visibleItems);
  const systemNavItems = visibleItems.filter(i => i.tier === 'system');

  const isNavItemActive = (item: NavItem): boolean => {
    if (item.action.type === 'switchTab') return activeTab === item.action.target && toolbarPanel === null;
    if (item.action.type === 'togglePanel') return toolbarPanel === item.action.target;
    if (item.action.type === 'custom' && item.id === 'taxonomy') return isPovTab && toolbarPanel === null;
    return false;
  };

  const dispatchNav = (action: NavAction) => {
    if (action.type === 'switchTab') {
      switchTab(action.target as TabId);
    } else if (action.type === 'togglePanel') {
      toggle(action.target as ToolbarPanel);
    } else if (action.type === 'custom') {
      if (action.id === 'taxonomy') {
        clearCurrentPanel();
        setToolbarPanel(null);
        if (['situations', 'conflicts', 'debate', 'chat', 'opeds', 'summaries', 'validation'].includes(activeTab)) setActiveTab('accelerationist');
      } else if (action.id === 'chat') {
        void api.openChatWindow();
      } else if (action.id === 'feedback') {
        setShowFeedback(true);
      } else if (action.id === 'help') {
        setShowHelp(true);
      } else if (action.id === 'reload') {
        if (!loading) void loadAll(true);
      } else if (action.id === 'settings') {
        setShowSettings(true);
      }
    }
  };

  const showAdminReview = isElectronMode() || adminFeatures;

  const renderNavItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`hamburger-item${isNavItemActive(item) ? ' active' : ''}`}
      onClick={() => act(() => dispatchNav(item.action))}
    >
      <item.icon size="1.25em" />
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
            <X size="1.25em" />
          </button>
          <span className="hamburger-title">Taxonomy Editor</span>
        </div>

        <div className="hamburger-body">
          {primaryNavItems.length > 0 && (
            <>
              {primaryNavItems.map(renderNavItem)}
              <div className="hamburger-divider" />
            </>
          )}

          {secondaryGroups.map((group, gi) => (
            <Fragment key={group.group}>
              {gi > 0 && <div className="hamburger-divider" />}
              {isPhone && <div className="hamburger-section">{GROUP_LABELS[group.group]}</div>}
              {group.items.map(renderNavItem)}
            </Fragment>
          ))}

          <div className="hamburger-divider" />

          {showAdminReview && (
            <button
              className={`hamburger-item${window.location.hash === '#admin' ? ' active' : ''}`}
              onClick={() => act(() => { window.location.hash = '#admin'; window.location.reload(); })}
            >
              <Shield size="1.25em" />
              <span>Admin Review</span>
            </button>
          )}

          <div className="hamburger-divider" />
          {systemNavItems.map(item => (
            <button
              key={item.id}
              className="hamburger-item"
              onClick={() => { dispatchNav(item.action); onClose(); }}
            >
              <item.icon size="1.25em" />
              <span>{item.label}</span>
            </button>
          ))}

          <AuthSection />
        </div>
      </div>

      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showFeedback && (
        <div className="dialog-overlay" onClick={() => setShowFeedback(false)}>
          <div onClick={e => e.stopPropagation()}>
            <FeedbackPopover onClose={() => setShowFeedback(false)} />
          </div>
        </div>
      )}
    </>
  );
}
