// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useTaxonomyStore, initAIModels } from './hooks/useTaxonomyStore';
import { Toolbar } from './components/Toolbar';
import { TabBar } from './components/TabBar';
import { SaveBar } from './components/SaveBar';
import { PovTab } from './components/PovTab';
import { CrossCuttingTab } from './components/CrossCuttingTab';
import { ConflictsTab } from './components/ConflictsTab';
import { DebateTab } from './components/DebateTab';
import { FirstRunDialog } from './components/FirstRunDialog';

interface DataUpdateInfo {
  available: boolean;
  behindCount: number;
  error?: string;
}

export function App() {
  const { activeTab, loading, loadAll, colorScheme, zoomLevel, zoomIn, zoomOut, zoomReset, toolbarPanel } = useTaxonomyStore();
  const [dataUpdate, setDataUpdate] = useState<DataUpdateInfo | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [dataRoot, setDataRoot] = useState('');

  useEffect(() => {
    // Check if data is available before loading
    Promise.all([
      window.electronAPI.isDataAvailable(),
      window.electronAPI.getDataRoot(),
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
    window.electronAPI.checkDataUpdates()
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
      const result = await window.electronAPI.pullDataUpdates() as { success: boolean; message: string };
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
    const unsub = window.electronAPI.onReloadTaxonomy(() => {
      useTaxonomyStore.getState().loadAll();
    });
    return unsub;
  }, []);

  // Listen for external focus-node requests (e.g. from summary-viewer)
  useEffect(() => {
    const unsub = window.electronAPI.onFocusNode((nodeId: string) => {
      const store = useTaxonomyStore.getState();
      // Determine which tab to navigate to based on node ID prefix
      let tab: Parameters<typeof store.navigateToNode>[0];
      if (nodeId.startsWith('cc-')) {
        tab = 'cross-cutting';
      } else if (nodeId.startsWith('acc-')) {
        tab = 'accelerationist';
      } else if (nodeId.startsWith('saf-')) {
        tab = 'safetyist';
      } else if (nodeId.startsWith('skp-')) {
        tab = 'skeptic';
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
    return <div className="loading">Loading taxonomy files...</div>;
  }

  return (
    <div className="app">
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
          {pullResult && <span className="data-update-result">{pullResult}</span>}
        </div>
      )}

      {toolbarPanel === null && !['cross-cutting', 'conflicts', 'debate'].includes(activeTab) && <TabBar />}
      <div className="app-body">
        <Toolbar />
        <div className="tab-content">
          {activeTab === 'accelerationist' && <PovTab pov="accelerationist" />}
          {activeTab === 'safetyist' && <PovTab pov="safetyist" />}
          {activeTab === 'skeptic' && <PovTab pov="skeptic" />}
          {activeTab === 'cross-cutting' && <CrossCuttingTab />}
          {activeTab === 'conflicts' && <ConflictsTab />}
          {activeTab === 'debate' && <DebateTab />}
        </div>
      </div>
      <SaveBar />
    </div>
  );
}
