// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import React, { Suspense, lazy } from 'react';
import { useTaxonomyStore } from '../../hooks/useTaxonomyStore';
import { useFlag } from '../../hooks/useFeatureFlags';

import { SearchPanel } from '../edge-browser/SearchPanel';
import { RelatedEdgesPanel } from '../edge-browser/RelatedEdgesPanel';
import { AttributeFilterPanel } from '../analysis/AttributeFilterPanel';
import { AttributeInfoPanel } from '../analysis/AttributeInfoPanel';
import { LineagePanel } from '../analysis/LineagePanel';
import { PromptsPanel } from '../chat/PromptsPanel';
import { FallacyPanel } from '../analysis/FallacyPanel';
import { EdgeBrowser } from '../edge-browser/EdgeBrowser';
import { PolicyAlignmentPanel } from '../analysis/PolicyAlignmentPanel';
import { PolicyDashboard } from '../analysis/PolicyDashboard';
import { VocabularyPanel } from './VocabularyPanel';
import { CalibrationDashboard } from '../analysis/CalibrationDashboard';
import type { PromptCatalogEntry } from '../../data/promptCatalog';
import './ToolbarPaneRenderer.css';

const TerminalPanel = lazy(() => import('./TerminalPanel').then(m => ({ default: m.TerminalPanel })));

const FULL_WIDTH_PANELS = new Set([
  'edges', 'console', 'policyAlignment', 'policyDashboard',
  'vocabulary', 'attrFilter', 'attrInfo', 'calibration',
]);

export function isFullWidthPanel(panel: string | null, promptInspectorActive: boolean): boolean {
  if (!panel) return false;
  if (panel === 'prompts' && promptInspectorActive) return true;
  return FULL_WIDTH_PANELS.has(panel);
}

interface ToolbarPaneRendererProps {
  panel: string | null;
  onSelectResult?: (id: string | null) => void;
  onAnalyze?: (element: { label: string; description: string; category: string }) => void;
  onSelectLineageValue?: (value: string | null) => void;
  onSelectFallacy?: (key: string | null) => void;
  onSelectPrompt?: (entry: PromptCatalogEntry | null) => void;
  onInspectorToggle?: (active: boolean) => void;
}

export function ToolbarPaneRenderer({
  panel,
  onSelectResult,
  onAnalyze,
  onSelectLineageValue,
  onSelectFallacy,
  onSelectPrompt,
  onInspectorToggle,
}: ToolbarPaneRendererProps) {
  const adminFeatures = useFlag('permission-admin-features');
  switch (panel) {
    case 'search': return <SearchPanel onSelectResult={onSelectResult} onAnalyze={onAnalyze} />;
    case 'related': return <RelatedEdgesPanel />;
    case 'attrFilter': return <AttributeFilterPanel />;
    case 'attrInfo': return <AttributeInfoPanel />;
    case 'lineage': return <LineagePanel onSelectValue={onSelectLineageValue} />;
    case 'prompts': return <PromptsPanel onSelectPrompt={onSelectPrompt ?? (() => {})} onInspectorToggle={onInspectorToggle} />;
    case 'fallacy': return <FallacyPanel onSelectFallacy={onSelectFallacy} />;
    case 'edges': return <EdgeBrowser />;
    case 'console': return adminFeatures
      ? <Suspense fallback={<div className="toolbar-pane-terminal-loading">Loading terminal...</div>}><TerminalPanel /></Suspense>
      : null;
    case 'policyAlignment': return <PolicyAlignmentPanel />;
    case 'policyDashboard': return <PolicyDashboard />;
    case 'vocabulary': return <VocabularyPanel />;
    case 'calibration': return <CalibrationDashboard />;
    default: return null;
  }
}

const TOOL_LABELS: Record<string, string> = {
  search: 'Search', related: 'Related Edges', attrFilter: 'Attribute Filter',
  attrInfo: 'Attribute Info', lineage: 'Intellectual Lineage', prompts: 'Prompts',
  fallacy: 'Possible Fallacies', edges: 'Edge Browser', console: 'Console',
  policyAlignment: 'Policy Alignment', policyDashboard: 'Policy Dashboard',
  vocabulary: 'Vocabulary', calibration: 'Calibration',
};

export function PhoneToolClose() {
  const { toolbarPanel, setToolbarPanel } = useTaxonomyStore();
  if (!toolbarPanel) return null;
  return (
    <div className="phone-tool-close">
      <button onClick={() => setToolbarPanel(null)} className="phone-tool-close-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {TOOL_LABELS[toolbarPanel] ?? toolbarPanel}
      </button>
    </div>
  );
}
