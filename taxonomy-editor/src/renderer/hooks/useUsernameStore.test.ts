// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const STORAGE_KEY = 'taxonomy-editor-username';

// Mock localStorage before store import (store reads at module level)
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn((key: string) => { storage.delete(key); }),
  clear: vi.fn(() => { storage.clear(); }),
  length: 0,
  key: vi.fn(),
};
vi.stubGlobal('localStorage', localStorageMock);

import { useUsernameStore, validateUsername } from './useUsernameStore';

describe('useUsernameStore', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    useUsernameStore.setState({
      username: null,
      promptOpen: false,
      onConfirm: null,
    });
  });

  describe('setUsername', () => {
    it('stores trimmed username in state and localStorage', () => {
      useUsernameStore.getState().setUsername('  Alice  ');
      expect(useUsernameStore.getState().username).toBe('Alice');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'Alice');
    });
  });

  describe('clearUsername', () => {
    it('removes username from state and localStorage', () => {
      useUsernameStore.getState().setUsername('Bob');
      useUsernameStore.getState().clearUsername();
      expect(useUsernameStore.getState().username).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
  });

  describe('confirmPrompt', () => {
    it('sets username, closes prompt, and calls onConfirm callback', () => {
      let confirmed: string | undefined;
      useUsernameStore.setState({
        promptOpen: true,
        onConfirm: (u) => { confirmed = u; },
      });

      useUsernameStore.getState().confirmPrompt('  Charlie  ');

      expect(useUsernameStore.getState().username).toBe('Charlie');
      expect(useUsernameStore.getState().promptOpen).toBe(false);
      expect(useUsernameStore.getState().onConfirm).toBeNull();
      expect(confirmed).toBe('Charlie');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'Charlie');
    });
  });

  describe('closePrompt', () => {
    it('closes prompt and clears callback', () => {
      useUsernameStore.setState({
        promptOpen: true,
        onConfirm: () => {},
      });

      useUsernameStore.getState().closePrompt();

      expect(useUsernameStore.getState().promptOpen).toBe(false);
      expect(useUsernameStore.getState().onConfirm).toBeNull();
    });
  });

  describe('ensureUsername', () => {
    it('returns existing username without opening prompt', async () => {
      useUsernameStore.getState().setUsername('Dana');
      const result = await useUsernameStore.getState().ensureUsername();
      expect(result).toBe('Dana');
      expect(useUsernameStore.getState().promptOpen).toBe(false);
    });

    it('opens prompt when no username is set', () => {
      useUsernameStore.getState().ensureUsername();
      expect(useUsernameStore.getState().promptOpen).toBe(true);
    });

    it('resolves with username after confirmPrompt', async () => {
      const promise = useUsernameStore.getState().ensureUsername();
      useUsernameStore.getState().confirmPrompt('Eve');
      const result = await promise;
      expect(result).toBe('Eve');
    });

    it('resolves with null after closePrompt', async () => {
      const promise = useUsernameStore.getState().ensureUsername();
      useUsernameStore.getState().closePrompt();
      const result = await promise;
      expect(result).toBeNull();
    });
  });
});

describe('validateUsername', () => {
  it('returns error for empty string', () => {
    expect(validateUsername('')).toBe('Username cannot be empty');
  });

  it('returns error for whitespace-only string', () => {
    expect(validateUsername('   ')).toBe('Username cannot be empty');
  });

  it('returns error for string over 50 chars', () => {
    expect(validateUsername('a'.repeat(51))).toBe('Username must be 50 characters or fewer');
  });

  it('returns null for valid username', () => {
    expect(validateUsername('Alice')).toBeNull();
  });

  it('returns null for username at exactly 50 chars', () => {
    expect(validateUsername('a'.repeat(50))).toBeNull();
  });
});
