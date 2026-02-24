import { useState } from 'react';
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
];

export function TabBar() {
  const { activeTab, setActiveTab } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
