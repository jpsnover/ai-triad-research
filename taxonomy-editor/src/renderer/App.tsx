// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect } from 'react';
import { useTaxonomyStore } from './hooks/useTaxonomyStore';
import { TabBar } from './components/TabBar';
import { SearchBar } from './components/SearchBar';
import { SaveBar } from './components/SaveBar';
import { PovTab } from './components/PovTab';
import { CrossCuttingTab } from './components/CrossCuttingTab';
import { ConflictsTab } from './components/ConflictsTab';

export function App() {
  const { activeTab, loading, loadAll, colorScheme, zoomLevel, zoomIn, zoomOut, zoomReset } = useTaxonomyStore();

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  if (loading) {
    return <div className="loading">Loading taxonomy files...</div>;
  }

  return (
    <div className="app">
      <TabBar />
      <SearchBar />
      <div className="tab-content">
        {activeTab === 'accelerationist' && <PovTab pov="accelerationist" />}
        {activeTab === 'safetyist' && <PovTab pov="safetyist" />}
        {activeTab === 'skeptic' && <PovTab pov="skeptic" />}
        {activeTab === 'cross-cutting' && <CrossCuttingTab />}
        {activeTab === 'conflicts' && <ConflictsTab />}
      </div>
      <SaveBar />
    </div>
  );
}
