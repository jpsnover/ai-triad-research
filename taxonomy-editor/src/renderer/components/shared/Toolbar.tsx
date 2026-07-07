// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useRef } from 'react';
import {
  Search, LayoutGrid, MessageSquare, MessageCircle, ArrowLeft,
  Ellipsis, Crosshair, TriangleAlert, CirclePlus, BookText,
  CircleCheck, GitFork, Link, Layers, BarChart3, ShieldAlert,
  BookOpen, LineChart, Terminal, FileText, CircleHelp, Star,
  RefreshCw, Settings, User, Users, Shield, LogOut,
} from 'lucide-react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { api, isElectronMode } from '@bridge';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { HelpDialog } from '../settings/HelpDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { useAuthStatus, useUserProfile } from '../../hooks/useAuthStatus';
import { useFlag } from '../../hooks/useFeatureFlags';
import { useTierInfo } from '../../hooks/useTierInfo';
import { FeedbackPopover } from './FeedbackPopover';
import './Toolbar.css';

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
        aria-label={auth.anonymous ? 'Sign in' : auth.user ?? 'Account'}
        data-tooltip={auth.anonymous ? 'Sign in' : auth.user}
      >
        {auth.anonymous ? (
          <User size={20} />
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
                <Users size={18} />
                <span>Community Library</span>
              </a>
              {adminFeatures && (
                <a className="toolbar-more-item" href="#admin" style={{ textDecoration: 'none', color: 'inherit' }}
                  onClick={() => setShowPopover(false)}>
                  <Shield size={18} />
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
                <LogOut size={18} />
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
    useTaxonomyStore.setState({ relatedNodeId: null, selectedEdge: null });
    setToolbarPanel(null);
    setActiveTab(tab);
  };

  const toggle = (panel: ToolbarPanel) => {
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
  };

  const isTaxonomyActive = toolbarPanel === null && !['situations', 'conflicts', 'cruxes', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab);

  return (
    <div className="toolbar">
      <div className="toolbar-top">
        {previousView && toolbarPanel !== null && activeTab !== 'debate' && (
          <>
            <button
              className="toolbar-icon toolbar-back"
              onClick={navigateBack}
              aria-label="Back"
              data-tooltip="Back"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="toolbar-separator" />
          </>
        )}
        {/* Primary nav — icon-over-label stacks */}
        <button
          className={`toolbar-nav${toolbarPanel === 'search' ? ' toolbar-nav-active' : ''}`}
          onClick={() => toggle('search')}
          aria-label="Search"
        >
          <Search size={20} />
          <span className="toolbar-nav-label">Search</span>
        </button>
        <button
          className={`toolbar-nav${isTaxonomyActive ? ' toolbar-nav-active' : ''}`}
          onClick={() => {
            clearCurrentPanel();
            setToolbarPanel(null);
            if (['situations', 'conflicts', 'debate', 'chat', 'summaries', 'validation'].includes(activeTab)) {
              setActiveTab('accelerationist');
            }
          }}
          aria-label="Taxonomy"
        >
          <LayoutGrid size={20} />
          <span className="toolbar-nav-label">Taxonomy</span>
        </button>
        <button
          className={`toolbar-nav${activeTab === 'debate' && toolbarPanel === null ? ' toolbar-nav-active' : ''}`}
          onClick={() => switchTab('debate')}
          aria-label="Debate"
        >
          <MessageSquare size={20} />
          <span className="toolbar-nav-label">Debate</span>
        </button>
        <button
          className="toolbar-nav"
          onClick={() => void api.openChatWindow()}
          aria-label="Chat"
        >
          <MessageCircle size={20} />
          <span className="toolbar-nav-label">Chat</span>
        </button>
      </div>
      <div className="toolbar-bottom">
        {/* Other Tools */}
        <div className="toolbar-more-wrap" ref={moreRef}>
          <button
            className={`toolbar-icon${moreHasActive || showMore ? ' toolbar-icon-active' : ''}`}
            onClick={() => setShowMore(v => !v)}
            aria-label="Other Tools"
            data-tooltip="Other Tools"
          >
            <Ellipsis size={20} />
          </button>
          {showMore && (
            <div className="toolbar-more-popover" role="menu">
              <button
                className={`toolbar-more-item${activeTab === 'situations' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('situations'); setShowMore(false); }}
              >
                <Crosshair size={18} />
                <span>Situations</span>
              </button>
              <button
                className={`toolbar-more-item${activeTab === 'conflicts' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('conflicts'); setShowMore(false); }}
              >
                <TriangleAlert size={18} />
                <span>Conflicts</span>
              </button>
              <button
                className={`toolbar-more-item${activeTab === 'cruxes' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('cruxes'); setShowMore(false); }}
              >
                <CirclePlus size={18} />
                <span>Cruxes</span>
              </button>
              {summariesFlag && (
              <button
                className={`toolbar-more-item${activeTab === 'summaries' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('summaries'); setShowMore(false); }}
              >
                <BookText size={18} />
                <span>Summaries</span>
              </button>
              )}
              <button
                className={`toolbar-more-item${activeTab === 'validation' && toolbarPanel === null ? ' active' : ''}`}
                onClick={() => { switchTab('validation'); setShowMore(false); }}
              >
                <CircleCheck size={18} />
                <span>Validation</span>
              </button>
              <div className="toolbar-more-divider" />
              <button
                className={`toolbar-more-item${toolbarPanel === 'lineage' ? ' active' : ''}`}
                onClick={() => { toggle('lineage'); setShowMore(false); }}
              >
                <GitFork size={18} />
                <span>Intellectual Lineage</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'edges' ? ' active' : ''}`}
                onClick={() => { toggle('edges'); setShowMore(false); }}
              >
                <Link size={18} />
                <span>Edge Browser</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'policyAlignment' ? ' active' : ''}`}
                onClick={() => { toggle('policyAlignment'); setShowMore(false); }}
              >
                <Layers size={18} />
                <span>Policy Alignment</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'policyDashboard' ? ' active' : ''}`}
                onClick={() => { toggle('policyDashboard'); setShowMore(false); }}
              >
                <BarChart3 size={18} />
                <span>Policy Dashboard</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'fallacy' ? ' active' : ''}`}
                onClick={() => { toggle('fallacy'); setShowMore(false); }}
              >
                <ShieldAlert size={18} />
                <span>Possible Fallacies</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'vocabulary' ? ' active' : ''}`}
                onClick={() => { toggle('vocabulary'); setShowMore(false); }}
              >
                <BookOpen size={18} />
                <span>Vocabulary</span>
              </button>
              <button
                className={`toolbar-more-item${toolbarPanel === 'calibration' ? ' active' : ''}`}
                onClick={() => { toggle('calibration'); setShowMore(false); }}
              >
                <LineChart size={18} />
                <span>Calibration</span>
              </button>
              <div className="toolbar-more-divider" />
              {adminFeatures && (
              <button
                className={`toolbar-more-item${toolbarPanel === 'console' ? ' active' : ''}`}
                onClick={() => { toggle('console'); setShowMore(false); }}
              >
                <Terminal size={18} />
                <span>Console</span>
              </button>
              )}
              <button
                className={`toolbar-more-item${toolbarPanel === 'prompts' ? ' active' : ''}`}
                onClick={() => { toggle('prompts'); setShowMore(false); }}
              >
                <FileText size={18} />
                <span>Prompts</span>
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-separator" />
        <button
          className="toolbar-icon"
          onClick={() => setShowHelp(true)}
          aria-label="Help"
          data-tooltip="Help"
        >
          <CircleHelp size={20} />
        </button>
        <div className="toolbar-feedback-wrap" ref={feedbackRef}>
          <button
            className={`toolbar-icon${showFeedback ? ' toolbar-icon-active' : ''}`}
            onClick={() => setShowFeedback(v => !v)}
            aria-label="Feedback"
            data-tooltip="Feedback"
          >
            <Star size={20} />
          </button>
          {showFeedback && <FeedbackPopover onClose={() => setShowFeedback(false)} />}
        </div>
        <ToolbarAuthButton />
        <button
          className={`toolbar-icon${loading ? ' toolbar-icon-spin' : ''}`}
          onClick={() => { if (!loading) void loadAll(); }}
          disabled={loading}
          aria-label="Reload taxonomy data"
          data-tooltip="Reload taxonomy data"
        >
          <RefreshCw size={20} />
        </button>
        <button
          className="toolbar-icon"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
          data-tooltip="Settings"
        >
          <Settings size={20} />
        </button>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
