// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useState, useEffect, useCallback } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { TabId } from '../types/taxonomy';
import { HelpDialog } from './HelpDialog';
import { SettingsDialog } from './SettingsDialog';

const TABS: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: 'Accelerationist' },
  { id: 'safetyist', label: 'Safetyist' },
  { id: 'skeptic', label: 'Skeptic' },
  { id: 'cross-cutting', label: 'Cross-Cutting' },
  { id: 'conflicts', label: 'Conflicts' },
  { id: 'debate', label: 'Debate' },
];

export function TabBar() {
  const { activeTab, setActiveTab, loadAll } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [taxonomyDirs, setTaxonomyDirs] = useState<string[]>([]);
  const [activeDir, setActiveDir] = useState('Origin');

  useEffect(() => {
    window.electronAPI.getTaxonomyDirs().then(setTaxonomyDirs);
    window.electronAPI.getActiveTaxonomyDir().then(setActiveDir);
  }, []);

  const handleDirChange = useCallback(async (dirName: string) => {
    await window.electronAPI.setTaxonomyDir(dirName);
    setActiveDir(dirName);
    await loadAll();
  }, [loadAll]);

  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          data-tab={tab.id}
          className={activeTab === tab.id ? 'active' : ''}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
      <div className="tab-bar-actions">
        {taxonomyDirs.length > 1 && (
          <select
            className="taxonomy-dir-select"
            value={activeDir}
            onChange={(e) => handleDirChange(e.target.value)}
            title="Switch taxonomy"
          >
            {taxonomyDirs.map((dir) => (
              <option key={dir} value={dir}>{dir}</option>
            ))}
          </select>
        )}
        <button className="tab-bar-menu-btn" onClick={() => setShowSettings(true)} title="Settings">
          Settings
        </button>
        <button className="tab-bar-menu-btn" onClick={() => setShowHelp(true)} title="Help">
          Help
        </button>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
