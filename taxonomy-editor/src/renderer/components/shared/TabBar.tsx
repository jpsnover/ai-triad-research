// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { POV_META } from '@lib/electron-shared/povMeta';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import type { TabId } from '../../types/taxonomy';
import { CampGlyph, povToCamp } from './CampGlyph';

const TABS: { id: TabId; label: string }[] = [
  { id: 'accelerationist', label: POV_META.accelerationist.label },
  { id: 'safetyist', label: POV_META.safetyist.label },
  { id: 'skeptic', label: POV_META.skeptic.label },
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
          {povToCamp(tab.id) && <CampGlyph camp={povToCamp(tab.id)!} size={14} />}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
