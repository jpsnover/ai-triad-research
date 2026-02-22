import { useEffect } from 'react';
import { useTaxonomyStore } from './hooks/useTaxonomyStore';
import { TabBar } from './components/TabBar';
import { SaveBar } from './components/SaveBar';
import { PovTab } from './components/PovTab';
import { CrossCuttingTab } from './components/CrossCuttingTab';
import { ConflictsTab } from './components/ConflictsTab';
import { FindBar } from './components/FindBar';

export function App() {
  const { activeTab, loading, loadAll } = useTaxonomyStore();

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (loading) {
    return <div className="loading">Loading taxonomy files...</div>;
  }

  return (
    <div className="app">
      <TabBar />
      <FindBar />
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
