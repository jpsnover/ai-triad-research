// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect } from 'react';
import { useStore } from './store/useStore';
import { useResizablePane } from './hooks/useResizable';
import Toolbar from './components/Toolbar';
import FilterBar from './components/FilterBar';
import StatsBar from './components/StatsBar';
import EdgeList from './components/EdgeList';
import EdgeDetail from './components/EdgeDetail';

function useThemeEffect() {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        root.dataset.theme = mq.matches ? 'dark' : 'light';
      };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    root.dataset.theme = theme;
  }, [theme]);
}

export default function App() {
  useThemeEffect();
  const loadData = useStore((s) => s.loadData);
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);

  const { width: listWidth, onMouseDown } = useResizablePane({
    initialWidth: 700,
    minWidth: 350,
    maxWidth: 1200,
    storageKey: 'edge-viewer-list-width',
  });

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!loaded) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading edges...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-loading">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Toolbar />
      <FilterBar />
      <StatsBar />
      <div className="main-panels">
        <div style={{ width: listWidth, flexShrink: 0 }}>
          <EdgeList />
        </div>
        <div className="resize-handle" onMouseDown={onMouseDown} />
        <EdgeDetail />
      </div>
    </div>
  );
}
