// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let policyRegistry: any;
const setToolbarPanel = vi.fn();
vi.mock('../../hooks/useTaxonomyStore', () => {
  const hook = () => ({ policyRegistry, edgesFile: null, setToolbarPanel });
  // getState is only reached when edgesFile is set (not in these tests).
  hook.getState = () => ({});
  hook.setState = () => {};
  return { useTaxonomyStore: hook };
});
vi.mock('../policy/PolicySourcesPanel', () => ({
  getPolicySourceIndex: () => Promise.resolve({}),
  PolicySourcesPanel: ({ policyId }: { policyId: string }) => <div>sources-for-{policyId}</div>,
}));
vi.mock('../organizations/StakeholderSection', () => ({
  StakeholderSection: ({ nodeId, queryType }: { nodeId: string; queryType: string }) => <div>stakeholders-{queryType}-{nodeId}</div>,
}));

const { PolicyDashboard } = await import('./PolicyDashboard');

describe('PolicyDashboard (t/1025)', () => {
  beforeEach(() => {
    policyRegistry = [
      { id: 'pol-1', action: 'Ban frontier training runs', member_count: 5, source_povs: ['accelerationist', 'safetyist'] },
      { id: 'pol-2', action: 'Open-source all weights', member_count: 2, source_povs: ['skeptic'] },
    ];
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows an empty state when the registry is not loaded', () => {
    policyRegistry = null;
    render(<PolicyDashboard />);
    expect(screen.getByText(/No policy registry loaded/)).toBeInTheDocument();
  });

  it('renders summary stats and the top-referenced list', () => {
    render(<PolicyDashboard />);
    expect(screen.getByText('Total Policies')).toBeInTheDocument();
    expect(screen.getByText('Cross-Perspective')).toBeInTheDocument();
    expect(screen.getByText('pol-1')).toBeInTheDocument();
    expect(screen.getByText('Ban frontier training runs')).toBeInTheDocument();
    expect(screen.getByText('Top 10 Most-Referenced Policies')).toBeInTheDocument();
  });

  it('opens the sources detail when a policy row is clicked', () => {
    render(<PolicyDashboard />);
    fireEvent.click(screen.getByText('pol-1'));
    expect(screen.getByText('Sources for pol-1')).toBeInTheDocument();
    expect(screen.getByText('sources-for-pol-1')).toBeInTheDocument();
    // t/1230: stakeholders section renders for the selected policy.
    expect(screen.getByText('stakeholders-policy-pol-1')).toBeInTheDocument();
  });
});
