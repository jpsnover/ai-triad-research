// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));

// Stub heavy child components to isolate SaveBar logic.
vi.mock('./UnsyncedChangesDrawer', () => ({ UnsyncedChangesDrawer: () => null }));
vi.mock('./SyncDiagnosticsDialog', () => ({ SyncDiagnosticsDialog: () => null }));
vi.mock('./TaxonomyDiffPanel', () => ({ TaxonomyDiffPanel: () => null }));
vi.mock('./TaxonomyUpdateToast', () => ({ TaxonomyUpdateToast: () => null }));
vi.mock('../shared', () => ({ TheoryLink: () => null }));

// Stub hooks with controllable return values.
const mockUseFlag = vi.fn();
vi.mock('../../hooks/useFeatureFlags', () => ({ useFlag: (flag: string) => mockUseFlag(flag) }));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    dirty: new Set(),
    save: vi.fn(),
    saveError: null,
    dismissSaveError: vi.fn(),
    validationErrors: {},
    integrityIssues: [],
    fixIntegrityErrors: vi.fn(),
  }),
}));

vi.mock('../../hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({
    status: {
      enabled: false,
      unsynced_count: 0,
      session_branch: null,
      pr_number: null,
      pr_url: null,
      push_pending: false,
      github_configured: false,
      main_updated_available: false,
      rebase_in_progress: false,
      has_conflicts: false,
    },
    refresh: vi.fn(),
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const { SaveBar } = await import('./SaveBar');

describe('SaveBar admin gate', () => {
  it('renders nothing for non-admin users', () => {
    mockUseFlag.mockReturnValue(false);
    const { container } = render(<SaveBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the bar for admin users', () => {
    mockUseFlag.mockReturnValue(true);
    const { container } = render(<SaveBar />);
    expect(container.querySelector('.save-bar')).not.toBeNull();
  });
});
