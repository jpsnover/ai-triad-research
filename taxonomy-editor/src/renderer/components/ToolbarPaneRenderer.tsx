// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { SearchPanel } from './SearchPanel';
import { RelatedEdgesPanel } from './RelatedEdgesPanel';
import { AttributeFilterPanel } from './AttributeFilterPanel';
import { AttributeInfoPanel } from './AttributeInfoPanel';
import { LineagePanel } from './LineagePanel';
import { PromptsPanel } from './PromptsPanel';
import { FallacyPanel } from './FallacyPanel';
import { EdgeBrowser } from './EdgeBrowser';
import { TerminalPanel } from './TerminalPanel';
import { PolicyAlignmentPanel } from './PolicyAlignmentPanel';
import { PolicyDashboard } from './PolicyDashboard';
import { VocabularyPanel } from './VocabularyPanel';
import { CalibrationDashboard } from './CalibrationDashboard';
import type { PromptCatalogEntry } from '../data/promptCatalog';

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
  switch (panel) {
    case 'search': return <SearchPanel onSelectResult={onSelectResult} onAnalyze={onAnalyze} />;
    case 'related': return <RelatedEdgesPanel />;
    case 'attrFilter': return <AttributeFilterPanel />;
    case 'attrInfo': return <AttributeInfoPanel />;
    case 'lineage': return <LineagePanel onSelectValue={onSelectLineageValue} />;
    case 'prompts': return <PromptsPanel onSelectPrompt={onSelectPrompt} onInspectorToggle={onInspectorToggle} />;
    case 'fallacy': return <FallacyPanel onSelectFallacy={onSelectFallacy} />;
    case 'edges': return <EdgeBrowser />;
    case 'console': return <TerminalPanel />;
    case 'policyAlignment': return <PolicyAlignmentPanel />;
    case 'policyDashboard': return <PolicyDashboard />;
    case 'vocabulary': return <VocabularyPanel />;
    case 'calibration': return <CalibrationDashboard />;
    default: return null;
  }
}
