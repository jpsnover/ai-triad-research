// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Contract tests for community debate pdf/markdown export routing (t/2400).
// Guards: community debate export calls loadCommunityDebateSession, not loadDebateSession.

import { describe, it, expect, vi } from 'vitest';
import { resolveExportLoader } from './DebateTab';
import type { SessionRowData } from './DebateTable';

function makeRow(overrides: Partial<SessionRowData> = {}): SessionRowData {
  return { id: 'row-1', title: 'Test', created_at: '2026-01-01', updated_at: '2026-01-01', phase: '', ...overrides };
}

describe('resolveExportLoader — community export discriminator (t/2400)', () => {
  it('calls loadCommunityDebateSession — not loadPersonal — for community=true (markdown/pdf)', async () => {
    const loadPersonal = vi.fn().mockResolvedValue({});
    const loadCommunity = vi.fn().mockResolvedValue({});
    await resolveExportLoader(makeRow({ id: 'c-1', community: true }), loadPersonal, loadCommunity);
    expect(loadCommunity).toHaveBeenCalledWith('c-1');
    expect(loadPersonal).not.toHaveBeenCalled();
  });

  it('calls loadPersonal — not loadCommunity — for community=false', async () => {
    const loadPersonal = vi.fn().mockResolvedValue({});
    const loadCommunity = vi.fn().mockResolvedValue({});
    await resolveExportLoader(makeRow({ id: 'p-1', community: false }), loadPersonal, loadCommunity);
    expect(loadPersonal).toHaveBeenCalledWith('p-1');
    expect(loadCommunity).not.toHaveBeenCalled();
  });

  it('calls loadPersonal when community is absent (personal debates — backward compat)', async () => {
    const loadPersonal = vi.fn().mockResolvedValue({});
    const loadCommunity = vi.fn().mockResolvedValue({});
    await resolveExportLoader(makeRow({ id: 'p-2' }), loadPersonal, loadCommunity);
    expect(loadPersonal).toHaveBeenCalledWith('p-2');
    expect(loadCommunity).not.toHaveBeenCalled();
  });
});
