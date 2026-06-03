// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState, lazy, Suspense } from 'react';
import { api } from '@bridge';
import { nodePovFromId } from '@lib/debate/nodeIdUtils';
import ErrorBoundary from '../../../lib/electron-shared/components/ErrorBoundary';
import { useTaxonomyStore, initAIModels } from './hooks/useTaxonomyStore';
import { Toolbar } from './components/Toolbar';
import { TabBar } from './components/TabBar';
import { SaveBar } from './components/SaveBar';
import { PovTab } from './components/PovTab';
import { SituationsTab } from './components/SituationsTab';
import { ConflictsTab } from './components/ConflictsTab';
import { DebateTab } from './components/DebateTab';
import { ChatTab } from './components/ChatTab';
import { FirstRunDialog } from './components/FirstRunDialog';
import { DeploymentErrorScreen } from './components/DeploymentErrorScreen';
import { StartupProgressScreen } from './components/StartupProgressScreen';
import { DiagnosticsWindow } from './components/DiagnosticsWindow';
import { PovProgressionWindow } from './components/PovProgression/PovProgressionWindow';
import { DebatePopoutWindow } from './components/DebatePopoutWindow';
import { PromptDiffWindow } from './components/PromptDiffWindow';
import { HarvestDialog } from './components/HarvestDialog';
import { SummariesTab } from './components/SummariesTab';
import { CruxesTab } from './components/CruxesTab';

import { initFlightRecorder } from './lib/flightRecorderInit';
import { getGlobalRecorder } from '@lib/flight-recorder/index';
import { initAnalytics } from './lib/analyticsEmitter';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useIsTouchDevice } from './hooks/useIsTouchDevice';
import { BottomNav } from './components/BottomNav';
import { HamburgerMenu } from './components/HamburgerMenu';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { GitProgressBanner } from './components/GitProgressBanner';
import { pullDataTracked } from './utils/syncApi';

const UpdatePrompt = import.meta.env.VITE_TARGET === 'web'
  ? lazy(() => import('./components/UpdatePrompt').then(m => ({ default: m.UpdatePrompt })))
  : null;

const THEME_COLORS: Record<string, string> = {
  light: '#ffffff',
  dark: '#111827',
  bkc: '#1f1f1f',
  harvard: '#A51C30',
};

// Build fingerprint — changes every build to verify deployment
const BUILD_FINGERPRINT = `build-${Date.now()}`;
console.log(`[App] BUILD_FINGERPRINT: ${BUILD_FINGERPRINT}`);

// Initialize flight recorder as early as possible
initFlightRecorder();

interface DataUpdateInfo {
  available: boolean;
  behindCount: number;
  currentCommit?: string;
  remoteCommit?: string;
  error?: string;
}

function FileViewerApp() {
  const [fileArg, setFileArg] = useState<{ type: string; path: string; data?: unknown; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[FileViewer] Requesting CLI file arg...');
    api.getCliFileArg().then((arg) => {
      console.log('[FileViewer] Got CLI arg:', arg ? { type: arg.type, path: arg.path, hasData: !!arg.data, dataKeys: arg.data ? Object.keys(arg.data as Record<string, unknown>) : [] } : null);
      setFileArg(arg as { type: string; path: string; data?: unknown; error?: string } | null);
      setLoading(false);
    }).catch(err => {
      console.error('[FileViewer] getCliFileArg failed:', err);
      setLoading(false);
    });
  }, []);

  console.log('[FileViewer] Render — loading:', loading, 'fileArg:', fileArg?.type, 'hasData:', !!fileArg?.data);

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading file...</div>;

  if (fileArg?.error) {
    return <div style={{ padding: 20, color: '#ef4444' }}>Error loading file: {fileArg.error}<br/>Path: {fileArg.path}</div>;
  }

  if (fileArg?.type === 'diagnostics' && fileArg.data) {
    return <DiagnosticsWindow initialData={fileArg.data as Record<string, unknown>} />;
  }

  if (fileArg?.type === 'harvest' && fileArg.data) {
    const harvestData = fileArg.data as Record<string, unknown>;
    console.log('[FileViewer] Rendering harvest with data:', {
      conflicts: (harvestData.conflicts as unknown[])?.length ?? 0,
      steelmans: (harvestData.steelmans as unknown[])?.length ?? 0,
      verdicts: (harvestData.verdicts as unknown[])?.length ?? 0,
      concepts: (harvestData.concepts as unknown[])?.length ?? 0,
    });
    return (
      <div style={{ padding: 20 }}>
        <h2 style={{ color: '#f59e0b' }}>Harvest Review</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>File: {fileArg.path}</p>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Items: {(harvestData.conflicts as unknown[])?.length ?? 0} conflicts,
          {' '}{(harvestData.steelmans as unknown[])?.length ?? 0} steelmans,
          {' '}{(harvestData.verdicts as unknown[])?.length ?? 0} verdicts,
          {' '}{(harvestData.concepts as unknown[])?.length ?? 0} concepts
        </p>
        <HarvestDialog onClose={() => window.close()} fileData={harvestData} />
      </div>
    );
  }

  return <div style={{ padding: 20, color: 'var(--text-muted)' }}>
    No file data found.
    <pre style={{ fontSize: '0.7rem', marginTop: 8 }}>{JSON.stringify(fileArg, null, 2)}</pre>
  </div>;
}

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // If this window was opened as a diagnostics popout, render only that
  if (hash === '#diagnostics-window') {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><DiagnosticsWindow /></ErrorBoundary>;
  }
  if (hash === '#pov-progression-window') {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><PovProgressionWindow /></ErrorBoundary>;
  }
  if (hash.startsWith('#debate-window')) {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><DebatePopoutWindow /></ErrorBoundary>;
  }
  if (hash.startsWith('#prompt-diff-window')) {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><PromptDiffWindow /></ErrorBoundary>;
  }
  if (hash === '#analytics' && import.meta.env.VITE_TARGET === 'web') {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><AnalyticsDashboard /></ErrorBoundary>;
  }

  // Route between CLI file viewer and main app
  return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><AppRouter /></ErrorBoundary>;
}

/** Handles CLI-mode detection — hooks are always called in same order */
function AppRouter() {
  const [cliMode, setCliMode] = useState<boolean | null>(null);
  useEffect(() => {
    void api.getCliFileArg().then(arg => setCliMode(!!arg));
  }, []);

  if (cliMode === null) return null; // loading
  if (cliMode) return <FileViewerApp />;
  return <MainApp />;
}

/** Main taxonomy editor application */
function MainApp() {
  const { activeTab, loading, backgroundLoading, loadingProgress, loadAll, colorScheme, paneSpacing, zoomLevel, zoomIn, zoomOut, zoomReset, toolbarPanel } = useTaxonomyStore();
  const breakpoint = useBreakpoint();
  const isTouch = useIsTouchDevice();
  const isMobile = breakpoint === 'phone' || breakpoint === 'phone-lg' || breakpoint === 'tablet';
  const [hamburgerOpen, setHamburgerOpen] = useState(false);
  const [dataUpdate, setDataUpdate] = useState<DataUpdateInfo | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<{ path: string; status: string }[] | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFilePath, setDiffFilePath] = useState<string | null>(null);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [dataRoot, setDataRoot] = useState('');
  const [copyStatus, setCopyStatus] = useState<{ state: string; dir?: string; copied?: number; total?: number } | null>(null);

  useEffect(() => {
    // Check if data is available before loading
    void Promise.all([
      api.isDataAvailable(),
      api.getDataRoot(),
    ]).then(([available, root]) => {
      setDataRoot(root);
      if (!available) {
        setShowFirstRun(true);
      } else {
        void initAIModels().then(() => { void loadAll(); void initAnalytics(); });
      }
    });
  }, [loadAll]);

  // Poll copy status while showFirstRun is true in web mode
  useEffect(() => {
    const isWeb = import.meta.env.VITE_TARGET === 'web';
    if (!showFirstRun || !isWeb || !dataRoot) return;

    let cancelled = false;
    const poll = () => {
      void api.getCopyStatus().then(status => {
        if (cancelled) return;
        setCopyStatus(status);
        if (status.state === 'complete') {
          // Copy finished — re-check data availability
          void api.isDataAvailable().then(available => {
            if (cancelled) return;
            if (available) {
              setShowFirstRun(false);
              setCopyStatus(null);
              void initAIModels().then(() => { void loadAll(); void initAnalytics(); });
            }
            // If still not available after copy complete, DeploymentErrorScreen will show
          });
        }
      });
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [showFirstRun, dataRoot, loadAll]);

  // Check for data updates after initial load
  useEffect(() => {
    if (loading) return;
    api.checkDataUpdates()
      .then((status: unknown) => {
        const s = status as DataUpdateInfo;
        if (s.available) {
          setDataUpdate(s);
        }
      })
      .catch(() => { /* offline or no git — silent */ });
  }, [loading]);

  const handlePullUpdates = async () => {
    setPulling(true);
    setPullResult(null);
    try {
      const result = await pullDataTracked(
        () => api.pullDataUpdates() as Promise<{ success: boolean; message: string }>,
      );
      if (result.success) {
        setPullResult('Updated successfully. Reloading...');
        setDataUpdate(null);
        // Reload taxonomy data with new data
        setTimeout(() => {
          void useTaxonomyStore.getState().loadAll();
          setPullResult(null);
        }, 1000);
      } else {
        setPullResult(`Update failed: ${result.message}`);
      }
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error',
        component: 'app',
        level: 'error',
        message: 'data pull failed',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
      setPullResult(`Error: ${String(err)}`);
    } finally {
      setPulling(false);
    }
  };

  const handleShowFiles = async () => {
    if (showFiles) { setShowFiles(false); return; }
    setLoadingFiles(true);
    try {
      const files = await api.getChangedFiles();
      setChangedFiles(files);
      setShowFiles(true);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'app', level: 'error',
        message: 'failed to fetch changed files',
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleViewDiff = async (filePath: string) => {
    if (diffFilePath === filePath) { setDiffContent(null); setDiffFilePath(null); return; }
    try {
      const diff = await api.getFileDiff(filePath);
      setDiffContent(diff);
      setDiffFilePath(filePath);
    } catch (err) {
      getGlobalRecorder()?.record({
        type: 'system.error', component: 'app', level: 'error',
        message: `failed to fetch diff for ${filePath}`,
        error: { name: (err as Error).name ?? 'Error', message: String(err) },
      });
    }
  };

  const dismissUpdate = () => { setDataUpdate(null); setShowFiles(false); setChangedFiles(null); };

  // Listen for menu-triggered taxonomy reload
  useEffect(() => {
    const unsub = api.onReloadTaxonomy(() => {
      void useTaxonomyStore.getState().loadAll();
    });
    return unsub;
  }, []);

  // Listen for external focus-node requests (e.g. from summary-viewer)
  useEffect(() => {
    const unsub = api.onFocusNode((nodeId: string) => {
      const store = useTaxonomyStore.getState();
      // Determine which tab to navigate to based on node ID prefix
      let tab: Parameters<typeof store.navigateToNode>[0];
      const pov = nodePovFromId(nodeId);
      if (pov) {
        tab = pov as typeof tab;
      } else if (nodeId.startsWith('conflict-')) {
        tab = 'conflicts';
      } else if (nodeId.startsWith('cc-') || nodeId.startsWith('pol-')) {
        tab = 'situations';
      } else {
        return; // Unknown prefix
      }
      store.navigateToNode(tab, nodeId);
    });
    return unsub;
  }, []);

  // Apply theme on mount and listen for system preference changes
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      let resolved: string;
      if (colorScheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolved = prefersDark ? 'dark' : 'light';
      } else {
        resolved = colorScheme;
      }
      root.setAttribute('data-theme', resolved);
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        'content', THEME_COLORS[resolved] || '#ffffff',
      );
    };
    apply();

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (colorScheme === 'system') apply(); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [colorScheme]);

  // Apply zoom level
  useEffect(() => {
    document.documentElement.style.fontSize = `${zoomLevel}%`;
  }, [zoomLevel]);

  // Apply pane spacing
  useEffect(() => {
    document.documentElement.setAttribute('data-pane-spacing', paneSpacing);
  }, [paneSpacing]);

  // Close hamburger when leaving mobile breakpoints
  useEffect(() => {
    if (!isMobile) setHamburgerOpen(false);
  }, [isMobile]);

  // Apply responsive breakpoint and touch attributes
  useEffect(() => {
    document.documentElement.setAttribute('data-breakpoint', breakpoint);
  }, [breakpoint]);
  useEffect(() => {
    document.documentElement.setAttribute('data-touch', String(isTouch));
  }, [isTouch]);

  // Zoom keyboard shortcuts: Ctrl+= / Ctrl+- / Ctrl+0
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut, zoomReset]);

  const handleFirstRunComplete = () => {
    setShowFirstRun(false);
    void initAIModels().then(() => { void loadAll(); void initAnalytics(); });
  };

  const handleFirstRunSkip = () => {
    setShowFirstRun(false);
    void initAIModels().then(() => { void loadAll(); void initAnalytics(); });
  };

  if (showFirstRun) {
    // Container mode with configured data root = deployment error, not first run
    const isWeb = import.meta.env.VITE_TARGET === 'web';
    if (isWeb && dataRoot) {
      // Show progress screen while copy is running, error screen only after copy completes
      if (copyStatus && copyStatus.state !== 'complete' && copyStatus.state !== 'unknown') {
        return <StartupProgressScreen status={copyStatus} />;
      }
      return <DeploymentErrorScreen dataRoot={dataRoot} />;
    }
    return <FirstRunDialog dataRoot={dataRoot} onComplete={handleFirstRunComplete} onSkip={handleFirstRunSkip} />;
  }

  if (loading) {
    const { completed, total } = loadingProgress;
    const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    return (
      <div className="loading">
        <div className="loading-title">Loading Accelerationist Perspective...</div>
        {total > 0 && (
          <>
            <div className="loading-bar-track">
              <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="loading-detail">
              {completed.length < 1 ? 'Loading...' : 'Initializing...'}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {/* Background loading indicator for remaining POVs */}
      {backgroundLoading && (
        <div className="background-loading-banner">
          <div className="background-loading-bar" />
          <span className="background-loading-text">
            Loading remaining Perspectives... ({loadingProgress.completed.length} of {loadingProgress.total})
          </span>
        </div>
      )}
      <GitProgressBanner />
      {/* Data update banner */}
      {dataUpdate && (
        <div
          className="data-update-banner"
          title="The taxonomy data is hosted in a public GitHub repository. This banner appears when new commits are available that your local copy doesn't have yet."
        >
          <span
            className="data-update-text"
            title={[
              `${dataUpdate.behindCount} new commit${dataUpdate.behindCount !== 1 ? 's' : ''} on the remote repository.`,
              dataUpdate.currentCommit ? `Local:  ${dataUpdate.currentCommit.slice(0, 8)}` : '',
              dataUpdate.remoteCommit ? `Remote: ${dataUpdate.remoteCommit.slice(0, 8)}` : '',
            ].filter(Boolean).join('\n')}
          >
            {dataUpdate.behindCount} data update{dataUpdate.behindCount !== 1 ? 's' : ''} available
          </span>
          <button
            className="btn btn-sm data-update-btn"
            onClick={handleShowFiles}
            disabled={loadingFiles}
            title="Show which files have been changed in the available updates"
          >
            {loadingFiles ? 'Loading...' : showFiles ? 'Hide Files' : 'Show Files'}
          </button>
          <button
            className="btn btn-sm data-update-btn"
            onClick={handlePullUpdates}
            disabled={pulling}
            title={pulling
              ? 'Downloading updates from GitHub — this may take a minute. The connection is kept alive with periodic heartbeats to prevent timeouts.'
              : 'Download the latest taxonomy data from GitHub. The data repository is public — no GitHub account or credentials are required.'}
          >
            {pulling ? 'Updating...' : 'Download'}
          </button>
          <button
            className="data-update-dismiss"
            onClick={dismissUpdate}
            title="Dismiss this notification. Updates will be checked again next time the app loads."
          >
            &times;
          </button>
          {pullResult && (
            <span
              className={`data-update-result ${pullResult.startsWith('Updated successfully') ? 'success' : 'error'}`}
              title={pullResult.startsWith('Updated successfully')
                ? 'Data updated to the latest version. The taxonomy is being reloaded with the new data.'
                : `The update failed. This is typically caused by network issues or slow connections — not by missing credentials. The data repository is public.\n\nFull error: ${pullResult}`}
            >
              {pullResult}
            </span>
          )}
          {showFiles && changedFiles && (
            <div className="data-update-files">
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed:
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {changedFiles.map(f => (
                  <div key={f.path} className="data-update-file-row">
                    <span className={`data-update-file-status data-update-file-status-${f.status}`}>
                      {f.status === 'M' ? 'MOD' : f.status === 'A' ? 'ADD' : f.status === 'D' ? 'DEL' : f.status}
                    </span>
                    <span className="data-update-file-path">{f.path}</span>
                    <button
                      className={`data-update-file-diff-btn${diffFilePath === f.path ? ' active' : ''}`}
                      onClick={() => void handleViewDiff(f.path)}
                      title={`View changes in ${f.path}`}
                    >
                      {diffFilePath === f.path ? 'Hide Diff' : 'View Diff'}
                    </button>
                  </div>
                ))}
              </div>
              {diffContent && diffFilePath && (
                <div className="data-update-diff-panel">
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Changes: {diffFilePath}</span>
                    <button className="data-update-file-diff-btn" onClick={() => { setDiffContent(null); setDiffFilePath(null); }}>Close</button>
                  </div>
                  <pre className="data-update-diff-content">
                    {diffContent.split('\n').map((line, i) => {
                      let cls = '';
                      if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add';
                      else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del';
                      else if (line.startsWith('@@')) cls = 'diff-hunk';
                      return <span key={i} className={cls}>{line}{'\n'}</span>;
                    })}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mobile-header">
        <button className="mobile-header-hamburger" onClick={() => setHamburgerOpen(true)} aria-label="Open menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="mobile-header-title">Taxonomy Editor</span>
      </div>
      {toolbarPanel === null && !['situations', 'conflicts', 'cruxes', 'debate', 'chat', 'summaries'].includes(activeTab) && <TabBar />}
      <div className="app-body">
        <Toolbar />
        <div className="tab-content">
          {activeTab === 'accelerationist' && <PovTab pov="accelerationist" />}
          {activeTab === 'safetyist' && <PovTab pov="safetyist" />}
          {activeTab === 'skeptic' && <PovTab pov="skeptic" />}
          {activeTab === 'situations' && <SituationsTab />}
          {activeTab === 'conflicts' && <ConflictsTab />}
          {activeTab === 'cruxes' && <CruxesTab />}
          {activeTab === 'debate' && <DebateTab />}
          {activeTab === 'chat' && <ChatTab />}
          {activeTab === 'summaries' && <SummariesTab />}
        </div>
      </div>
      <SaveBar />
      <BottomNav />
      {isMobile && <HamburgerMenu isOpen={hamburgerOpen} onClose={() => setHamburgerOpen(false)} />}
      {UpdatePrompt && <Suspense fallback={null}><UpdatePrompt /></Suspense>}
    </div>
  );
}
