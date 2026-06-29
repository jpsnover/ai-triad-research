// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api, isElectronMode } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { HelpDialog } from '../settings/HelpDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useAuthStatus, useUserProfile } from '../../hooks/useAuthStatus';
import { useFlag } from '../../hooks/useFeatureFlags';
import { useTierInfo } from '../../hooks/useTierInfo';
import { FeedbackPopover } from './FeedbackPopover';

type ToolbarPanel = 'search' | 'related' | 'attrFilter' | 'attrInfo' | 'lineage' | 'prompts' | 'console' | 'fallacy' | 'edges' | 'policyAlignment' | 'policyDashboard' | 'vocabulary' | 'calibration';

function useAdminReviewCount(): number {
  const adminFeatures = useFlag('permission-admin-features');
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isElectronMode() && !adminFeatures) return;
    let cancelled = false;
    let configState: boolean | null = null;
    const doPoll = () => {
      api.adminReviewStats()
        .then(s => { if (!cancelled && s) setCount(s.total ?? 0); })
        .catch((err) => {
          getGlobalRecorder()?.record({ type: 'system.error', component: 'Toolbar', level: 'warn', message: 'Admin review stats poll failed', error: { name: (err as Error).name ?? 'Error', message: String(err), stack: (err as Error).stack } });
        });
    };
    const poll = () => {
      if (isElectronMode()) {
        if (configState === false) return;
        if (configState === null) {
          api.adminReviewConfigured().then(configured => {
            configState = configured;
            if (configured) doPoll();
          }).catch(() => {});
          return;
        }
      }
      doPoll();
    };
    poll();
    const id = setInterval(poll, 300_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [adminFeatures]);
  return count;
}

function ToolbarAuthButton() {
  const auth = useAuthStatus();
  const profile = useUserProfile();
  const adminFeatures = useFlag('permission-admin-features');
  const { tier, usage } = useTierInfo();
  const [showPopover, setShowPopover] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const reviewCount = useAdminReviewCount();

  useEffect(() => {
    if (!showPopover) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showPopover]);

  if (!auth) return null;

  const initial = auth.anonymous ? '?' : (auth.user?.[0] ?? '?').toUpperCase();

  return (
    <div className="toolbar-auth-wrap" ref={wrapRef}>
      <button
        className={`toolbar-icon toolbar-auth-btn${showPopover ? ' toolbar-icon-active' : ''}`}
        onClick={() => setShowPopover(v => !v)}
        data-tooltip={auth.anonymous ? 'Sign in' : auth.user}
      >
        {auth.anonymous ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <span className="toolbar-auth-avatar">{initial}</span>
        )}
      </button>
      {showPopover && (
        <div className="toolbar-auth-popover" role="menu">
          {auth.anonymous ? (
            <>
              <div className="toolbar-auth-anon-banner">Anonymous mode — data is temporary. Sign in to save.</div>
              {tier?.level === 'free' && (
                <div className="toolbar-auth-quota" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--info, #3b82f6)' }}>Free Tier</span>
                  <span>{tier.pinnedModel} &middot; {tier.limits.requestsPerMinute} req/min &middot; {Math.round(tier.limits.tokensPerDay / 1000)}K tokens/day</span>
                  {usage && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Used: {usage.usage.requestsInWindow} req &middot; {Math.round(usage.usage.tokensToday / 1000)}K tokens today
                    </span>
                  )}
                </div>
              )}
              <a className="toolbar-more-item" href="/api/auth/fresh-login/github" style={{ textDecoration: 'none', color: 'inherit' }}
                onClick={() => setShowPopover(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                <span>Sign in with GitHub</span>
              </a>
              <a className="toolbar-more-item" href="/api/auth/fresh-login/google" style={{ textDecoration: 'none', color: 'inherit' }}
                onClick={() => setShowPopover(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v8" /><path d="M8 12h8" /></svg>
                <span>Sign in with Google</span>
              </a>
            </>
          ) : (
            <>
              <div className="toolbar-auth-identity">
                <span className="toolbar-auth-avatar-lg">{initial}</span>
                <div className="toolbar-auth-details">
                  <span className="toolbar-auth-name">{auth.user}</span>
                  <span className="toolbar-auth-meta">
                    {auth.idp ? `via ${auth.idp}` : ''}
                    {adminFeatures && <span className="toolbar-auth-admin-badge">Admin</span>}
                  </span>
                </div>
              </div>
              {profile?.quotas && (
                <div className="toolbar-auth-quota">
                  Chats: {profile.quotas.maxChats} max &middot; Debates: {profile.quotas.maxDebates} max
                </div>
              )}
              {tier && (
                <div className="toolbar-auth-quota">
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{tier.level} Tier</span>
                  {' '}&middot; {tier.limits.requestsPerMinute} req/min &middot; {Math.round(tier.limits.tokensPerDay / 1000)}K tokens/day
                  {usage && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      Used: {usage.usage.requestsInWindow} req &middot; {Math.round(usage.usage.tokensToday / 1000)}K tokens today
                    </div>
                  )}
                </div>
              )}
              <div className="toolbar-auth-divider" />
              <a className="toolbar-more-item" href="#community" style={{ textDecoration: 'none', color: 'inherit' }}
                onClick={() => setShowPopover(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                <span>Community Library</span>
              </a>
              {adminFeatures && (
                <a className="toolbar-more-item" href="#admin" style={{ textDecoration: 'none', color: 'inherit' }}
                  onClick={() => setShowPopover(false)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  <span>Admin Review</span>
                  {reviewCount > 0 && (
                    <span className="toolbar-auth-admin-badge" style={{ marginLeft: 6 }}>
                      {reviewCount}
                    </span>
                  )}
                </a>
              )}
              <div className="toolbar-auth-divider" />
              <a className="toolbar-more-item" href="/api/auth/logout" style={{ textDecoration: 'none', color: 'inherit' }}
                onClick={() => { getGlobalRecorder()?.record({ type: 'auth.logout_initiated', component: 'auth', level: 'info', message: 'User initiated logout', data: { target: '/api/auth/logout', source: 'toolbar' } }); setShowPopover(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                <span>Sign out</span>
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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
    loadAll, loading,
  } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

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

  const adminFeatures = useFlag('permission-admin-features');
  const summariesFlag = useFlag('env-electron-summaries');
  const morePanels: ToolbarPanel[] = ['lineage', 'edges', 'policyAlignment', 'policyDashboard', 'fallacy', 'vocabulary', 'calibration', ...(adminFeatures ? ['console' as const] : []), 'prompts'];
  const moreTabsActive = ['situations', 'conflicts', 'cruxes', 'summaries', 'validation'].includes(activeTab) && toolbarPanel === null;
  const moreHasActive = morePanels.includes(toolbarPanel as ToolbarPanel) || moreTabsActive;

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

  const switchTab = (tab: 'situations' | 'conflicts' | 'cruxes' | 'debate' | 'chat' | 'summaries' | 'validation') => {
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
          className={`toolbar-icon${toolbarPanel === null && !['situations', 'conflicts', 'cruxes', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab) ? ' toolbar-icon-active' : ''}`}
          onClick={() => {
            clearCurrentPanel();
            setToolbarPanel(null);
            if (['situations', 'conflicts', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab)) {
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
        {/* Debate */}
        <button
          className={`toolbar-icon${activeTab === 'debate' && toolbarPanel === null ? ' toolbar-icon-active' : ''}`}
          onClick={() => switchTab('debate')}
          data-tooltip="Debate"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        {/* Chat (popout) */}
        <button
          className="toolbar-icon"
          onClick={() => void api.openChatWindow()}
          data-tooltip="Chat"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
        <div className="toolbar-separator" />
        {/* Other Tools */}
        <div className="toolbar-more-wrap" ref={moreRef}>
          <button
            className={`toolbar-icon${moreHasActive || showMore ? ' toolbar-icon-active' : ''}`}
            onClick={() => setShowMore(v => !v)}
            data-tooltip="Other Tools"
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
                className={`toolbar-more-item${activeTab === 'situations' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('situations'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>Situations</span>
              </button>
              <button
                className={`toolbar-more-item${activeTab === 'conflicts' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('conflicts'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Conflicts</span>
              </button>
              <button
                className={`toolbar-more-item${activeTab === 'cruxes' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('cruxes'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>Cruxes</span>
              </button>
              {summariesFlag && (
              <button
                className={`toolbar-more-item${activeTab === 'summaries' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('summaries'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <line x1="8" y1="7" x2="16" y2="7" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                <span>Summaries</span>
              </button>
              )}
              <button
                className={`toolbar-more-item${activeTab === 'validation' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('validation'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>Validation</span>
              </button>
              <div className="toolbar-more-divider" />
              <button
                className={`toolbar-more-item${toolbarPanel === 'lineage' ? ' active' : ''}`}
                onClick={() => { toggle('lineage'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18" />
                  <path d="M8 7l4-4 4 4" />
                  <path d="M5 12h14" />
                  <path d="M8 17l-3 3" />
                  <path d="M16 17l3 3" />
                </svg>
                <span>Intellectual Lineage</span>
              </button>
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
              <div className="toolbar-more-divider" />
              {adminFeatures && (
              <button
                className={`toolbar-more-item${toolbarPanel === 'console' ? ' active' : ''}`}
                onClick={() => { toggle('console'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>Console</span>
              </button>
              )}
              <button
                className={`toolbar-more-item${toolbarPanel === 'prompts' ? ' active' : ''}`}
                onClick={() => { toggle('prompts'); setShowMore(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span>Prompts</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="toolbar-bottom">
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
        <div className="toolbar-feedback-wrap" ref={feedbackRef}>
          <button
            className={`toolbar-icon${showFeedback ? ' toolbar-icon-active' : ''}`}
            onClick={() => setShowFeedback(v => !v)}
            data-tooltip="Feedback"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 18.5L3 22l1-7L1 8h7l4-7 4 7h7l-3 7 1 7z" />
            </svg>
          </button>
          {showFeedback && <FeedbackPopover onClose={() => setShowFeedback(false)} />}
        </div>
        <ToolbarAuthButton />
        <button
          className={`toolbar-icon${loading ? ' toolbar-icon-spin' : ''}`}
          onClick={() => { if (!loading) void loadAll(); }}
          disabled={loading}
          data-tooltip="Reload taxonomy data"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
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
