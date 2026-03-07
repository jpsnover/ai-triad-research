// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useStore } from '../store/useStore';
import ThemeSwitcher from './ThemeSwitcher';

export default function Toolbar() {
  const indexedEdges = useStore((s) => s.indexedEdges);
  const proposed = indexedEdges.filter((e) => e.status === 'proposed').length;
  const approved = indexedEdges.filter((e) => e.status === 'approved').length;
  const rejected = indexedEdges.filter((e) => e.status === 'rejected').length;

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <h1 className="app-title">Edge Viewer</h1>
        <span className="toolbar-stats">
          <span className="stat-badge total">{indexedEdges.length} total</span>
          <span className="stat-badge proposed">{proposed} proposed</span>
          <span className="stat-badge approved">{approved} approved</span>
          <span className="stat-badge rejected">{rejected} rejected</span>
        </span>
      </div>
      <ThemeSwitcher />
    </div>
  );
}
