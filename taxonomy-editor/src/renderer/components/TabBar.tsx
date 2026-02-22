import { useTaxonomyStore } from '../hooks/useTaxonomyStore';
import type { TabId } from '../types/taxonomy';

const TABS: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: 'Accelerationist' },
  { id: 'safetyist', label: 'Safetyist' },
  { id: 'skeptic', label: 'Skeptic' },
  { id: 'cross-cutting', label: 'Cross-Cutting' },
  { id: 'conflicts', label: 'Conflicts' },
];

export function TabBar() {
  const { activeTab, setActiveTab } = useTaxonomyStore();

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
    </div>
  );
}
