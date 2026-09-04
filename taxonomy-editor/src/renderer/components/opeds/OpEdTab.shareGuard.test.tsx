// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2987 + t/3315 — the reader's Share control. Own op-eds share via /api/oped-sets/:id/share ("🔗
// Share"); community op-eds are PUBLIC and share via /api/community/opeds/:id/share ("🔗 Get public
// link", t/3315). This locks the guard: no share when shareSource is null; own vs community render
// distinct controls (different endpoint + label). Share is web-only (t/2728).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OpEdSet } from '../../../../../lib/oped/types';

// Web mode (share is web-only, t/2728); api is only touched on click, not on render.
vi.mock('@bridge', () => ({
  api: { shareOpEdSet: vi.fn(), unshareOpEdSet: vi.fn(), shareCommunityOpEd: vi.fn() },
  isElectronMode: () => false,
}));

import { OpEdReaderView } from './OpEdTab';

const SHARE_LABEL_MY = 'Create a public share link';
const SHARE_LABEL_COMMUNITY = 'Get a public share link for this community op-ed';
const set = { set_id: 'set-1' } as unknown as OpEdSet;

// readerLoading keeps OpEdReader unrendered so we isolate the reader bar (where Share lives).
function renderReader(shareSource: 'my' | 'community' | null) {
  return render(
    <OpEdReaderView
      readerSet={set}
      readerLoading
      readerError={null}
      status={null}
      onBack={() => {}}
      shareSource={shareSource}
    />,
  );
}

describe('OpEdReaderView Share guard (t/2987 + t/3315)', () => {
  it('renders NO share control when shareSource is null', () => {
    renderReader(null);
    expect(screen.queryByLabelText(SHARE_LABEL_MY)).toBeNull();
    expect(screen.queryByLabelText(SHARE_LABEL_COMMUNITY)).toBeNull();
  });

  it("renders '🔗 Share' for the user's own op-ed (shareSource='my')", () => {
    renderReader('my');
    expect(screen.queryByLabelText(SHARE_LABEL_MY)).not.toBeNull();
    expect(screen.queryByLabelText(SHARE_LABEL_COMMUNITY)).toBeNull();
  });

  it("renders '🔗 Get public link' for a community op-ed (shareSource='community', t/3315)", () => {
    renderReader('community');
    expect(screen.queryByLabelText(SHARE_LABEL_COMMUNITY)).not.toBeNull();
    expect(screen.queryByLabelText(SHARE_LABEL_MY)).toBeNull();
  });
});
