import { useState } from 'react';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { TabId } from '../types/taxonomy';
import type { ColorScheme } from '../hooks/useTaxonomyStore';
import { HelpDialog } from './HelpDialog';

const TABS: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: 'Accelerationist' },
  { id: 'safetyist', label: 'Safetyist' },
  { id: 'skeptic', label: 'Skeptic' },
  { id: 'cross-cutting', label: 'Cross-Cutting' },
  { id: 'conflicts', label: 'Conflicts' },
];

export function TabBar() {
  const { activeTab, setActiveTab, colorScheme, setColorScheme } = useTaxonomyStore();
  const [showHelp, setShowHelp] = useState(false);

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
      <div className="theme-selector">
        <label>Theme</label>
        <select
          value={colorScheme}
          onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
        <button className="help-btn" onClick={() => setShowHelp(true)} title="Help">
          ? Help
        </button>
      </div>
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}
