// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2987 + t/3315 — the reader's Share control. Own op-eds share via /api/oped-sets/:id/share ("🔗
// Share"); community op-eds are PUBLIC and share via /api/community/opeds/:id/share ("🔗 Get public
// link", t/3315). This locks the guard: no share when shareSource is null; own vs community render
// distinct controls (different endpoint + label). Share is web-only (t/2728).
//
// t/3426: also locks WHICH id gets posted for a community op-ed — the community-share endpoint
// keys on the community addressing id (the community list entry's `.id`), NOT the loaded
// document's own `.set_id` (the submitter's original id, which can differ once a community
// submission is addressed distinctly from its source, t/856). The bug shipped because every prior
// fixture used set_id === communityId, so the mismatch was never exercised.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpEdSet } from '../../../../../lib/oped/types';

const shareCommunityOpEd = vi.fn().mockResolvedValue({ shareId: 'share-1' });

// Web mode (share is web-only, t/2728); api is only touched on click, not on render.
vi.mock('@bridge', () => ({
  api: { shareOpEdSet: vi.fn(), unshareOpEdSet: vi.fn(), shareCommunityOpEd: (...args: unknown[]) => shareCommunityOpEd(...args) },
  isElectronMode: () => false,
}));

import { OpEdReaderView } from './OpEdTab';

const SHARE_LABEL_MY = 'Create a public share link';
const SHARE_LABEL_COMMUNITY = 'Get a public share link for this community op-ed';
const set = { set_id: 'set-1' } as unknown as OpEdSet;

// readerLoading keeps OpEdReader unrendered so we isolate the reader bar (where Share lives).
function renderReader(shareSource: 'my' | 'community' | null, communityId: string | null = null) {
  return render(
    <OpEdReaderView
      readerSet={set}
      readerLoading
      readerError={null}
      status={null}
      onBack={() => {}}
      shareSource={shareSource}
      communityId={communityId}
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
    renderReader('community', 'community-1');
    expect(screen.queryByLabelText(SHARE_LABEL_COMMUNITY)).not.toBeNull();
    expect(screen.queryByLabelText(SHARE_LABEL_MY)).toBeNull();
  });

  it('renders NO share control for a community op-ed when communityId is missing', () => {
    // Defensive: if the caller ever fails to thread communityId, fail closed (no broken share
    // button) rather than falling back to the wrong (set_id) id — t/3426's exact failure mode.
    renderReader('community', null);
    expect(screen.queryByLabelText(SHARE_LABEL_COMMUNITY)).toBeNull();
  });

  it('t/3426: posts the COMMUNITY id, not the document set_id, when they differ', async () => {
    // The regression fixture: set_id ('set-1') deliberately != communityId ('community-1') —
    // every fixture before this bug used set_id === communityId, hiding the mismatch.
    const user = userEvent.setup();
    renderReader('community', 'community-1');
    await user.click(screen.getByLabelText(SHARE_LABEL_COMMUNITY));
    expect(shareCommunityOpEd).toHaveBeenCalledWith('community-1');
    expect(shareCommunityOpEd).not.toHaveBeenCalledWith(set.set_id);
  });
});
