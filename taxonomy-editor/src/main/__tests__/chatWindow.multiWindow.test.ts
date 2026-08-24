// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Unit tests for multi-window chat registry (t/2564, t/2780).
// Verifies: per-chatId dedup, cap enforcement, MRU focus-at-cap, cascade offset,
// closed-event cleanup, main-window notification, and destroyed-window pruning.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

// ---------------------------------------------------------------------------
// Shared mock state (module-level so vi.fn implementations close over them)
// ---------------------------------------------------------------------------

const mockWins: Record<string, unknown>[] = [];
let winIdCounter = 0;

function makeMockWin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = ++winIdCounter;
  return {
    id,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    on: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn() },
    ...overrides,
  };
}

// vi.hoisted so these are available inside vi.mock factories.
const mockHandle = vi.hoisted(() => vi.fn());
const mockGetPrimaryDisplay = vi.hoisted(() =>
  vi.fn(() => ({ workAreaSize: { width: 1920, height: 1080 } })),
);

// BrowserWindow mock: must use a regular function (not arrow) so `new BW()` works.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockBrowserWindow = vi.hoisted(() => vi.fn(function MockBW(this: any) {
  const win = makeMockWin();
  mockWins.push(win);
  return win;
}));

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
  BrowserWindow: MockBrowserWindow,
  screen: { getPrimaryDisplay: mockGetPrimaryDisplay },
  app: { isPackaged: false },
}));

vi.mock('../fileIO.js', () => ({ PROJECT_ROOT: '/fake/root' }));

// ---------------------------------------------------------------------------

import { registerChatWindowHandlers, chatWindows, MAX_CHAT_WINDOWS } from '../ipc/chatWindowHandlers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getHandler(): (event: unknown, chatId: string, source?: string) => Promise<unknown> {
  const calls = (mockHandle as ReturnType<typeof vi.fn>).mock.calls;
  const entry = calls.find((c: unknown[]) => c[0] === 'open-chat-window');
  if (!entry) throw new Error('open-chat-window handler not registered');
  return entry[1] as (event: unknown, chatId: string, source?: string) => Promise<unknown>;
}

function makeMainWindow(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } };
}

// Stub event object (handler ignores it)
const EVENT = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockWins.length = 0;
  winIdCounter = 0;
  chatWindows.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerChatWindowHandlers — open-chat-window', () => {
  it('registers the open-chat-window IPC handler', () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    expect(mockHandle).toHaveBeenCalledWith('open-chat-window', expect.any(Function));
  });

  it('creates a new window and adds it to chatWindows', async () => {
    const hardenWindow = vi.fn();
    registerChatWindowHandlers('/fake/preload.cjs', () => makeMainWindow() as never, hardenWindow);
    await getHandler()(EVENT, 'chat-abc');

    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(chatWindows.size).toBe(1);
    expect(hardenWindow).toHaveBeenCalledTimes(1);
  });

  it('passes preloadPath into BrowserWindow webPreferences', async () => {
    registerChatWindowHandlers('/my/preload.cjs', () => null, vi.fn());
    await getHandler()(EVENT, 'chat-abc');

    const opts = (MockBrowserWindow as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(opts?.webPreferences?.preload).toBe('/my/preload.cjs');
  });

  it('focuses existing window for same chatId (per-session dedup)', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    await handler(EVENT, 'chat-dup');
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(chatWindows.size).toBe(1);

    // Second call with same chatId — must focus, not create
    await handler(EVENT, 'chat-dup');
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1); // no new window
    const win = mockWins[0]!;
    expect((win.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((win.show as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('opens a new window for different chatIds', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    await handler(EVENT, 'chat-1');
    await handler(EVENT, 'chat-2');
    expect(MockBrowserWindow).toHaveBeenCalledTimes(2);
    expect(chatWindows.size).toBe(2);
  });

  it('applies cascade offset on second window', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    await handler(EVENT, 'chat-1');
    const firstOpts = (MockBrowserWindow as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstOpts?.x).toBeUndefined();

    await handler(EVENT, 'chat-2');
    const secondOpts = (MockBrowserWindow as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
    expect(secondOpts?.x).toBe(30);
    expect(secondOpts?.y).toBe(30);
  });

  it('focuses MRU window (no new window) when at cap', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    for (let i = 0; i < MAX_CHAT_WINDOWS; i++) {
      const win = makeMockWin();
      chatWindows.set(`chat-${i}`, win as never);
    }
    const mruWin = [...chatWindows.values()].at(-1) as unknown as Record<string, unknown>;

    const result = await handler(EVENT, 'chat-new');

    expect(MockBrowserWindow).not.toHaveBeenCalled();
    expect(result).toEqual({ atCap: true });
    expect((mruWin.show as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    expect((mruWin.focus as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('restores a minimized MRU window when at cap', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    for (let i = 0; i < MAX_CHAT_WINDOWS; i++) {
      const win = makeMockWin({ isMinimized: vi.fn(() => true) });
      chatWindows.set(`chat-${i}`, win as never);
    }
    const mruWin = [...chatWindows.values()].at(-1) as unknown as Record<string, unknown>;

    await handler(EVENT, 'chat-new');
    expect((mruWin.restore as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('prunes destroyed windows then creates a new one', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    const handler = getHandler();

    for (let i = 0; i < MAX_CHAT_WINDOWS; i++) {
      const win = makeMockWin({ isDestroyed: vi.fn(() => true) });
      chatWindows.set(`chat-${i}`, win as never);
    }

    await handler(EVENT, 'chat-new');

    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(chatWindows.size).toBe(1);
  });

  it('removes window from chatWindows on closed event', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => makeMainWindow() as never, vi.fn());
    await getHandler()(EVENT, 'chat-abc');

    const win = mockWins[0]!;
    const closedCb = (win.on as ReturnType<typeof vi.fn>).mock.calls
      .find((c: unknown[]) => c[0] === 'closed')?.[1] as () => void;

    expect(chatWindows.size).toBe(1);
    closedCb();
    expect(chatWindows.size).toBe(0);
  });

  it('sends chat-popout-closed with chatId to main window on chat close', async () => {
    const mainWin = makeMainWindow();
    registerChatWindowHandlers('/fake/preload.cjs', () => mainWin as never, vi.fn());
    await getHandler()(EVENT, 'chat-xyz');

    const win = mockWins[0]!;
    const closedCb = (win.on as ReturnType<typeof vi.fn>).mock.calls
      .find((c: unknown[]) => c[0] === 'closed')?.[1] as () => void;

    closedCb();
    expect(mainWin.webContents.send).toHaveBeenCalledWith('chat-popout-closed', 'chat-xyz');
  });

  it('does not crash when main window is null on closed', async () => {
    registerChatWindowHandlers('/fake/preload.cjs', () => null, vi.fn());
    await getHandler()(EVENT, 'chat-abc');

    const win = mockWins[0]!;
    const closedCb = (win.on as ReturnType<typeof vi.fn>).mock.calls
      .find((c: unknown[]) => c[0] === 'closed')?.[1] as () => void;

    expect(() => closedCb()).not.toThrow();
  });

  it('does not crash when main window is destroyed on closed', async () => {
    const mainWin = makeMainWindow(true);
    registerChatWindowHandlers('/fake/preload.cjs', () => mainWin as never, vi.fn());
    await getHandler()(EVENT, 'chat-abc');

    const win = mockWins[0]!;
    const closedCb = (win.on as ReturnType<typeof vi.fn>).mock.calls
      .find((c: unknown[]) => c[0] === 'closed')?.[1] as () => void;

    expect(() => closedCb()).not.toThrow();
  });
});
