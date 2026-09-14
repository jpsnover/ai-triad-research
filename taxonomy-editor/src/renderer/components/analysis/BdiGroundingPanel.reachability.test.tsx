// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * t/3470 — BdiGroundingPanel shipped fully tested across three tickets (t/3292, t/3397,
 * t/3466) with no mount point anywhere in the running app: no case in ToolbarPaneRenderer's
 * switch, no ToolbarPanel type variant. Component-level tests can't catch this — they render
 * the component directly, never proving anything actually reaches it. This test renders the
 * REAL ToolbarPaneRenderer (the shared mount point, wired by t/3470 PR #2178) with every
 * sibling panel stubbed except BdiGroundingPanel, and asserts real BdiGroundingPanel content
 * appears for panel='bdiGrounding'. If the case is ever removed or the import breaks, this
 * fails — "component tests green" can no longer mask "unreachable."
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: () => false }));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    selectedNodeId: null,
    accelerationist: null,
    safetyist: null,
    skeptic: null,
    setToolbarPanel: vi.fn(),
  }),
}));

// Every ToolbarPaneRenderer sibling stubbed out — irrelevant to this reachability check and
// each carries its own heavy deps (bridge, stores) that would otherwise need mocking too.
// BdiGroundingPanel is deliberately the ONE panel left real — that's what this test proves.
vi.mock('../edge-browser/SearchPanel', () => ({ SearchPanel: () => null }));
vi.mock('../edge-browser/RelatedEdgesPanel', () => ({ RelatedEdgesPanel: () => null }));
vi.mock('./AttributeFilterPanel', () => ({ AttributeFilterPanel: () => null }));
vi.mock('./AttributeInfoPanel', () => ({ AttributeInfoPanel: () => null }));
vi.mock('./LineagePanel', () => ({ LineagePanel: () => null }));
vi.mock('../chat/PromptsPanel', () => ({ PromptsPanel: () => null }));
vi.mock('./FallacyPanel', () => ({ FallacyPanel: () => null }));
vi.mock('../edge-browser/EdgeBrowser', () => ({ EdgeBrowser: () => null }));
vi.mock('./PolicyAlignmentPanel', () => ({ PolicyAlignmentPanel: () => null }));
vi.mock('./PolicyDashboard', () => ({ PolicyDashboard: () => null }));
vi.mock('../shared/VocabularyPanel', () => ({ VocabularyPanel: () => null }));
vi.mock('../shared/EntityBrowserPanel', () => ({ EntityBrowserPanel: () => null }));
vi.mock('./CalibrationDashboard', () => ({ CalibrationDashboard: () => null }));

const { ToolbarPaneRenderer } = await import('../shared/ToolbarPaneRenderer');

describe('BdiGroundingPanel reachability via ToolbarPaneRenderer (t/3470)', () => {
  it('renders real BdiGroundingPanel content for panel="bdiGrounding"', () => {
    render(<ToolbarPaneRenderer panel="bdiGrounding" />);
    // This is BdiGroundingPanel's actual empty-state text, not a stub — proves the mount
    // point reaches the real component, not just that a case exists in the switch.
    expect(screen.getByText(/Select a BDI node to view its concept and entity links\./)).toBeInTheDocument();
  });

  it('renders nothing for an unknown panel id (baseline — the switch has a default: null)', () => {
    render(<ToolbarPaneRenderer panel="not-a-real-panel" />);
    expect(screen.queryByText(/Select a BDI node/)).not.toBeInTheDocument();
  });
});
