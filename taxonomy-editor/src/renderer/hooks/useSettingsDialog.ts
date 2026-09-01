// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';

/**
 * Global signal for opening the Settings dialog from surfaces outside the
 * Toolbar (t/3190). The dialog itself is rendered/owned by the Toolbar, which
 * subscribes to `isOpen`; any component (e.g. the daily-quota banners) can call
 * `useSettingsDialog.getState().open()` to route the user to Settings → API Keys
 * without threading callbacks through the tree.
 */
interface SettingsDialogStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useSettingsDialog = create<SettingsDialogStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
