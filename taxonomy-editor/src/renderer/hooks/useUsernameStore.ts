// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';

const STORAGE_KEY = 'taxonomy-editor-username';

function loadUsername(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
}

function saveUsername(username: string): void {
  try { localStorage.setItem(STORAGE_KEY, username); } catch { /* ignore */ }
}

function removeUsername(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function validateUsername(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Username cannot be empty';
  if (trimmed.length > 50) return 'Username must be 50 characters or fewer';
  return null;
}

interface UsernameStore {
  username: string | null;
  promptOpen: boolean;
  /** Callback invoked after username is confirmed via the prompt dialog */
  onConfirm: ((username: string) => void) | null;

  setUsername: (username: string) => void;
  clearUsername: () => void;
  /** Open the prompt dialog. Returns a promise that resolves with the username, or null if cancelled. */
  requestUsername: () => Promise<string | null>;
  /** Ensure a username is set — returns it immediately if already set, otherwise opens the prompt. */
  ensureUsername: () => Promise<string | null>;
  closePrompt: () => void;
  confirmPrompt: (username: string) => void;
}

export const useUsernameStore = create<UsernameStore>((set, get) => ({
  username: loadUsername(),
  promptOpen: false,
  onConfirm: null,

  setUsername: (username: string) => {
    const trimmed = username.trim();
    saveUsername(trimmed);
    set({ username: trimmed });
  },

  clearUsername: () => {
    removeUsername();
    set({ username: null });
  },

  requestUsername: () => {
    return new Promise<string | null>((resolve) => {
      set({
        promptOpen: true,
        onConfirm: (username: string) => resolve(username),
      });
      // If cancelled (closePrompt called), resolve with null
      const unsub = useUsernameStore.subscribe((state, prev) => {
        if (prev.promptOpen && !state.promptOpen && state.onConfirm === null) {
          unsub();
          resolve(null);
        }
      });
    });
  },

  ensureUsername: async () => {
    const { username, requestUsername } = get();
    if (username) return username;
    return requestUsername();
  },

  closePrompt: () => {
    set({ promptOpen: false, onConfirm: null });
  },

  confirmPrompt: (username: string) => {
    const { onConfirm } = get();
    const trimmed = username.trim();
    saveUsername(trimmed);
    // Call onConfirm before clearing state so the promise resolves
    // before the subscription sees promptOpen=false and resolves with null
    onConfirm?.(trimmed);
    set({ username: trimmed, promptOpen: false, onConfirm: null });
  },
}));
