// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SyncDiagnostics, SyncStatus } from '../../utils/syncApi';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => null }));
vi.mock('./GitProgressBanner', () => ({ GitProgressBanner: () => null }));

const getSyncDiagnostics = vi.fn();
const getSyncStatus = vi.fn();
vi.mock('../../utils/syncApi', () => ({
  getSyncDiagnostics: (...args: unknown[]) => getSyncDiagnostics(...args),
  getSyncStatus: (...args: unknown[]) => getSyncStatus(...args),
  createPullRequestTracked: vi.fn(),
  fetchOriginTracked: vi.fn(),
  resetMainTracked: vi.fn(),
  setGithubCredentials: vi.fn(),
  clearGithubCredentials: vi.fn(),
}));

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    enabled: true, unsynced_count: 0, session_branch: null, pr_number: null,
    pr_url: null, push_pending: false, github_configured: true,
    main_updated_available: false, rebase_in_progress: false,
    ...overrides,
  };
}

function makeDiag(overrides: Partial<SyncDiagnostics> = {}): SyncDiagnostics {
  return {
    mode: 'github-api', git_ok: true, files: [], unsynced_count: 0,
    session_branch: null, pr_number: null, pr_url: null,
    cache_hit_rate: null, cache_file_count: null,
    circuit_state: 'closed', rate_limit_remaining: null,
    recent_commits: [], head_sha: null, main_sha: null,
    ...overrides,
  } as unknown as SyncDiagnostics;
}

const { SyncDiagnosticsDialog } = await import('./SyncDiagnosticsDialog');

describe('SyncDiagnosticsDialog — cache_hit_rate typeof guard', () => {
  it('shows "--" when cache_hit_rate arrives as a string (t/2999)', async () => {
    getSyncDiagnostics.mockResolvedValue(makeDiag({ cache_hit_rate: '0.85' as unknown as number }));
    getSyncStatus.mockResolvedValue(makeStatus());

    render(<SyncDiagnosticsDialog open={true} onClose={vi.fn()} />);

    const label = await screen.findByText('Cache Hit Rate');
    const row = label.closest('.sync-diag-kv');
    const value = row?.querySelector('.sync-diag-kv-value');
    expect(value?.textContent).toBe('--');
  });

  it('renders percentage when cache_hit_rate is a valid number', async () => {
    getSyncDiagnostics.mockResolvedValue(makeDiag({ cache_hit_rate: 0.85 }));
    getSyncStatus.mockResolvedValue(makeStatus());

    render(<SyncDiagnosticsDialog open={true} onClose={vi.fn()} />);

    const label = await screen.findByText('Cache Hit Rate');
    const row = label.closest('.sync-diag-kv');
    const value = row?.querySelector('.sync-diag-kv-value');
    expect(value?.textContent).toBe('85.0%');
  });
});
