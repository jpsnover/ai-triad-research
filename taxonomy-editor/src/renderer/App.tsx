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
import { DiagnosticsWindow } from './components/DiagnosticsWindow';
import { PovProgressionWindow } from './components/PovProgression/PovProgressionWindow';
import { HarvestDialog } from './components/HarvestDialog';
import { SummariesTab } from './components/SummariesTab';

// Build fingerprint — changes every build to verify deployment
const BUILD_FINGERPRINT = `build-${Date.now()}`;
console.log(`[App] BUILD_FINGERPRINT: ${BUILD_FINGERPRINT}`);

interface DataUpdateInfo {
  available: boolean;
  behindCount: number;
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

  // Route between CLI file viewer and main app
  return <ErrorBoundary buildInfo={BUILD_FINGERPRINT}><AppRouter /></ErrorBoundary>;
}

/** Handles CLI-mode detection — hooks are always called in same order */
function AppRouter() {
  const [cliMode, setCliMode] = useState<boolean | null>(null);
  useEffect(() => {
    api.getCliFileArg().then(arg => setCliMode(!!arg));
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

  useEffect(() => {
    // Check if data is available before loading
    Promise.all([
      api.isDataAvailable(),
      api.getDataRoot(),
    ]).then(([available, root]) => {
      setDataRoot(root);
      if (!available) {
        setShowFirstRun(true);
      } else {
        initAIModels().then(() => loadAll());
      }
    });
  }, [loadAll]);

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
          useTaxonomyStore.getState().loadAll();
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
      useTaxonomyStore.getState().loadAll();
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
    initAIModels().then(() => loadAll());
  };

  const handleFirstRunSkip = () => {
    setShowFirstRun(false);
    initAIModels().then(() => loadAll());
  };

  if (showFirstRun) {
    return <FirstRunDialog dataRoot={dataRoot} onComplete={handleFirstRunComplete} onSkip={handleFirstRunSkip} />;
  }

  if (loading) {
    const { completed, total } = loadingProgress;
    const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    return (
      <div className="loading">
        <div className="loading-title">Loading Accelerationist POV...</div>
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
            Loading remaining POVs... ({loadingProgress.completed.length} of {loadingProgress.total})
          </span>
        </div>
      )}
      {/* Data update banner */}
      {dataUpdate && (
        <div className="data-update-banner">
          <span className="data-update-text">
            {dataUpdate.behindCount} data update{dataUpdate.behindCount !== 1 ? 's' : ''} available
          </span>
          <button
            className="btn btn-sm data-update-btn"
            onClick={handlePullUpdates}
            disabled={pulling}
          >
            {pulling ? 'Updating...' : 'Download'}
          </button>
          <button className="data-update-dismiss" onClick={dismissUpdate} title="Dismiss">&times;</button>
          {pullResult && <span className={`data-update-result ${pullResult.startsWith('Updated successfully') ? 'success' : 'error'}`}>{pullResult}</span>}
        </div>
      )}

      {toolbarPanel === null && !['situations', 'conflicts', 'debate', 'chat', 'summaries'].includes(activeTab) && <TabBar />}
      <div className="app-body">
        <Toolbar />
        <div className="tab-content">
          {activeTab === 'accelerationist' && <PovTab pov="accelerationist" />}
          {activeTab === 'safetyist' && <PovTab pov="safetyist" />}
          {activeTab === 'skeptic' && <PovTab pov="skeptic" />}
          {activeTab === 'situations' && <SituationsTab />}
          {activeTab === 'conflicts' && <ConflictsTab />}
          {activeTab === 'debate' && <DebateTab />}
          {activeTab === 'chat' && <ChatTab />}
          {activeTab === 'summaries' && <SummariesTab />}
        </div>
      </div>
      <SaveBar />
    </div>
  );
}
