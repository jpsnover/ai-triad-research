// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useFeatureFlagStore, useFlag } from './useFeatureFlags';
import type { NavVisibilityContext } from '../data/navConfig';

/**
 * Single source of truth for the nav visibility context consumed by
 * `getVisibleNavItems`. Threads the WHOLE feature-flag record — not a hardcoded
 * subset — so a nav gate can never reference a flag the context forgot to pass.
 *
 * History: Toolbar and HamburgerMenu each built `navCtx.flags` from a handful of
 * explicit `useFlag()` calls. `getVisibleNavItems` treats an absent flag as falsy,
 * so any gate flag omitted from that subset silently hid its item even with the
 * flag ON — twice (t/2599 env-electron-opeds; t/2633 env-web-opeds). Passing the
 * store's full record makes the subset (and its drift) disappear; behavior is
 * unchanged because each gate still only reads its own flags. See NAV_GATE_FLAGS.
 */
export function useNavVisibilityContext(): NavVisibilityContext {
  const flags = useFeatureFlagStore((s) => s.flags);
  const isAdmin = useFlag('permission-admin-features');
  return { flags, isAdmin };
}
