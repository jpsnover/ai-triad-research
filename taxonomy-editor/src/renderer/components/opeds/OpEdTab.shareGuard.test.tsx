// @vitest-environment jsdom
// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/2987 — the reader's Share control was shown for ANY open op-ed, so sharing a
// community-loaded op-ed hit /api/oped-sets/:id/share → 404 (the id isn't in the user's
// own oped-sets store). Design: Share (My) / Copy (Community). This locks the guard:
// Share renders only when the open op-ed is the user's own (canShare).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OpEdSet } from '../../../../../lib/oped/types';

// Web mode (share is web-only, t/2728); api is only touched on click, not on render.
vi.mock('@bridge', () => ({
  api: { shareOpEdSet: vi.fn(), unshareOpEdSet: vi.fn() },
  isElectronMode: () => false,
}));

import { OpEdReaderView } from './OpEdTab';

const SHARE_LABEL = 'Create a public share link';
const set = { set_id: 'set-1' } as unknown as OpEdSet;

// readerLoading keeps OpEdReader unrendered so we isolate the reader bar (where Share lives).
function renderReader(canShare: boolean) {
  return render(
    <OpEdReaderView
      readerSet={set}
      readerLoading
      readerError={null}
      status={null}
      onBack={() => {}}
      canShare={canShare}
    />,
  );
}

describe('OpEdReaderView Share guard (t/2987)', () => {
  it('does NOT render Share for a community op-ed (canShare=false)', () => {
    renderReader(false);
    expect(screen.queryByLabelText(SHARE_LABEL)).toBeNull();
  });

  it("renders Share for the user's own op-ed (canShare=true)", () => {
    renderReader(true);
    expect(screen.queryByLabelText(SHARE_LABEL)).not.toBeNull();
  });
});
