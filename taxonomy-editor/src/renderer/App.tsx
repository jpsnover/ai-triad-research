// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
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
import { HarvestDialog } from './components/HarvestDialog';
import { SummariesTab } from './components/SummariesTab';
import { CruxesTab } from './components/CruxesTab';

import { initFlightRecorder } from './lib/flightRecorderInit';
import { initAnalytics } from './lib/analyticsEmitter';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';

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
  // If this window was opened as a diagnostics popout, render only that
  if (window.location.hash === '#diagnostics-window') {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><DiagnosticsWindow /></ErrorBoundary>;
  }
  if (window.location.hash === '#pov-progression-window') {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><PovProgressionWindow /></ErrorBoundary>;
  }
  if (window.location.hash.startsWith('#debate-window')) {
    return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><DebatePopoutWindow /></ErrorBoundary>;
  }
  if (window.location.hash === '#analytics' && import.meta.env.VITE_TARGET === 'web') {
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
  const [dataUpdate, setDataUpdate] = useState<DataUpdateInfo | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
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
      const result = await api.pullDataUpdates() as { success: boolean; message: string };
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
      setPullResult(`Error: ${String(err)}`);
    } finally {
      setPulling(false);
    }
  };

  const dismissUpdate = () => setDataUpdate(null);

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
      if (colorScheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        root.setAttribute('data-theme', colorScheme);
      }
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
        </div>
      )}

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
    </div>
  );
}
