// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiagnosticsChatSidebar } from './DiagnosticsChatSidebar';
import type { DebateSession } from '../../../types/debate';

// ── Mocks ───────────────────────────────────────────────────────────────────

// react-markdown uses ESM-only exports that jsdom cannot load — replace with a
// simple pass-through that surfaces text content so assertions can read it.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: {} }));

// Bridge — only the methods this component actually calls.
vi.mock('@bridge', () => ({
  api: {
    loadTaxonomyFile:  vi.fn().mockResolvedValue(null),
    hasApiKey:         vi.fn().mockResolvedValue(false),
    startChatStream:   vi.fn().mockResolvedValue(''),
    onChatStreamChunk: vi.fn().mockReturnValue(() => {}),
  },
}));

// Flight recorder — keep it null (the component guards all calls with ?.)
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => null,
}));

// AI-client defaults — simple string so we can assert on the header label.
vi.mock('@lib/ai-client/defaults', () => ({
  DEFAULT_MODEL: 'test-model',
}));

// Soul docs are imported transitively by @lib/debate/types → poverInfo.ts.
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({
  default: { label: 'Accelerationist', pov: 'accelerationist' },
}));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json', () => ({
  default: { label: 'Safetyist', pov: 'safetyist' },
}));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json', () => ({
  default: { label: 'Skeptic', pov: 'skeptic' },
}));

// Override POVER_INFO with plain objects; keep the rest of the module real so
// POV_KEYS and type exports still work correctly.
vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist' },
      safetyist:       { label: 'Safetyist',       pov: 'safetyist'       },
      skeptic:         { label: 'Skeptic',          pov: 'skeptic'         },
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDebate(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'debate-1',
    title: 'Test Debate',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    phase: 'debate',
    topic: { original: 'AI safety', refined: null, final: 'AI safety' },
    source_type: 'topic',
    source_ref: '',
    source_content: '',
    active_povers: ['accelerationist', 'safetyist', 'skeptic'],
    user_is_pover: false,
    transcript: [
      {
        id: 'S1',
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'statement',
        speaker: 'accelerationist',
        content: 'AI will accelerate progress.',
        taxonomy_refs: [],
      },
    ],
    context_summaries: [],
    ...overrides,
  } as DebateSession;
}

const defaultProps = {
  debate: null as DebateSession | null,
  selectedEntry: null as string | null,
  currentTab: 'details',
  onNavigate: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DiagnosticsChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // jsdom stubs scrollIntoView as a no-op in modern versions; be explicit so
    // the smooth-scroll calls in effects never cause "not a function" errors.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    // Reset any body-style mutations left by resize drag tests.  Without this,
    // `document.body.style.cursor = 'col-resize'` leaks across test boundaries
    // and causes the next `querySelector('[style*="col-resize"]')` to match
    // document.body instead of the resize handle element.
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // ── 1. Hook-ordering regression guard (t/585) ────────────────────────────
  //
  // Before the fix, useState/useRef/useCallback were placed AFTER a 190-line
  // JSX variable assignment, causing React to see a different hook count on
  // re-render.  These tests mount the component in every prop combination that
  // exercises the early-return branches so that any future regression will
  // immediately surface as "rendered more hooks than previous render".

  describe('hook ordering — mounts without throwing', () => {
    it('debate=null, not embedded (renders floating button)', () => {
      expect(() => render(<DiagnosticsChatSidebar {...defaultProps} />)).not.toThrow();
    });

    it('debate=null, embedded (renders chat content)', () => {
      expect(() =>
        render(<DiagnosticsChatSidebar {...defaultProps} embedded />),
      ).not.toThrow();
    });

    it('debate provided, not embedded (starts closed)', () => {
      expect(() =>
        render(<DiagnosticsChatSidebar {...defaultProps} debate={makeDebate()} />),
      ).not.toThrow();
    });

    it('debate provided, embedded (starts open)', () => {
      expect(() =>
        render(
          <DiagnosticsChatSidebar
            {...defaultProps}
            debate={makeDebate()}
            embedded
          />,
        ),
      ).not.toThrow();
    });
  });

  // ── 2. Closed state (non-embedded) ──────────────────────────────────────

  describe('closed state — non-embedded', () => {
    it('renders the floating toggle button', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      expect(
        screen.getByTitle('Open Debate Chat (Ctrl+Shift+D)'),
      ).toBeInTheDocument();
    });

    it('toggle button shows the chat icon character', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      expect(screen.getByTitle('Open Debate Chat (Ctrl+Shift+D)')).toHaveTextContent('?');
    });

    it('does not render chat content when closed', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      expect(screen.queryByText('Debate Chat')).not.toBeInTheDocument();
    });
  });

  // ── 3. Toggle button opens the chat ──────────────────────────────────────

  describe('toggle button — opens chat', () => {
    it('shows "Debate Chat" header after clicking the toggle button', async () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      await userEvent.click(screen.getByTitle('Open Debate Chat (Ctrl+Shift+D)'));
      expect(screen.getByText('Debate Chat')).toBeInTheDocument();
    });

    it('removes the toggle button from the DOM after opening', async () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      await userEvent.click(screen.getByTitle('Open Debate Chat (Ctrl+Shift+D)'));
      expect(
        screen.queryByTitle('Open Debate Chat (Ctrl+Shift+D)'),
      ).not.toBeInTheDocument();
    });
  });

  // ── 4. Embedded mode ─────────────────────────────────────────────────────

  describe('embedded mode', () => {
    it('renders chat content immediately — no toggle button needed', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.getByText('Debate Chat')).toBeInTheDocument();
      expect(
        screen.queryByTitle('Open Debate Chat (Ctrl+Shift+D)'),
      ).not.toBeInTheDocument();
    });

    it('calls onClose when the × button is clicked', async () => {
      const onClose = vi.fn();
      render(
        <DiagnosticsChatSidebar {...defaultProps} embedded onClose={onClose} />,
      );
      await userEvent.click(screen.getByTitle('Close chat (Esc)'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not close the panel internally in embedded mode — onClose is delegated', async () => {
      const onClose = vi.fn();
      render(
        <DiagnosticsChatSidebar {...defaultProps} embedded onClose={onClose} />,
      );
      await userEvent.click(screen.getByTitle('Close chat (Esc)'));
      // Chat content must still be in the DOM — the parent controls visibility.
      expect(screen.getByText('Debate Chat')).toBeInTheDocument();
    });
  });

  // ── 5. No-debate state ───────────────────────────────────────────────────

  describe('no-debate state (debate=null)', () => {
    it('shows "Waiting for debate data..." placeholder text', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(
        screen.getByPlaceholderText('Waiting for debate data...'),
      ).toBeInTheDocument();
    });

    it('disables the textarea when debate is null', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.getByPlaceholderText('Waiting for debate data...')).toBeDisabled();
    });

    it('disables the Send button when debate is null', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.getByText('Send')).toBeDisabled();
    });
  });

  // ── 6. Empty-messages state ──────────────────────────────────────────────

  describe('empty messages state', () => {
    it('shows the onboarding hint when no messages exist', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(
        screen.getByText(/Ask questions about the debate/),
      ).toBeInTheDocument();
    });

    it('does not show the Clear button when the message list is empty', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.queryByTitle('Clear chat (Ctrl+L)')).not.toBeInTheDocument();
    });
  });

  // ── 7. Suggestion chips ──────────────────────────────────────────────────

  describe('suggestion chips', () => {
    it('renders a local suggestion chip when debate is provided and selectedEntry is null', () => {
      render(
        <DiagnosticsChatSidebar
          {...defaultProps}
          debate={makeDebate()}
          embedded
        />,
      );
      // localSuggestions[0] when selectedEntry=null and no convergence/commitments
      expect(
        screen.getByText('Which debater has the strongest arguments?'),
      ).toBeInTheDocument();
    });

    it('renders the argument-network chip alongside the strength chip', () => {
      render(
        <DiagnosticsChatSidebar
          {...defaultProps}
          debate={makeDebate()}
          embedded
        />,
      );
      expect(screen.getByText('Show the argument network')).toBeInTheDocument();
    });

    it('clicking a chip populates the textarea with the suggestion text', async () => {
      render(
        <DiagnosticsChatSidebar
          {...defaultProps}
          debate={makeDebate()}
          embedded
        />,
      );
      await userEvent.click(
        screen.getByText('Which debater has the strongest arguments?'),
      );
      expect(
        screen.getByPlaceholderText('Ask about the debate... (/ for commands)'),
      ).toHaveValue('Which debater has the strongest arguments?');
    });

    it('renders entry-specific suggestions when selectedEntry matches a transcript entry', () => {
      render(
        <DiagnosticsChatSidebar
          {...defaultProps}
          debate={makeDebate()}
          selectedEntry="S1"
          embedded
        />,
      );
      expect(screen.getByText('Show brief for S1')).toBeInTheDocument();
    });

    it('renders no suggestion chips when debate is null', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      // localSuggestions is [] when debate is null — no chip buttons in the
      // suggestions row.  The only buttons are the × and Send controls.
      const buttons = screen.getAllByRole('button');
      const chipButtons = buttons.filter(
        b => !b.title && b.textContent !== 'Send',
      );
      expect(chipButtons).toHaveLength(0);
    });
  });

  // ── 8. Resize handle ────────────────────────────────────────────────────

  describe('resize handle (drag-to-resize)', () => {
    it('renders a drag handle with col-resize cursor when the sidebar is open', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      // The resize handle is the only element with an inline col-resize cursor.
      const handle = document.querySelector('[style*="col-resize"]') as HTMLElement | null;
      expect(handle).not.toBeNull();
    });

    it('sets body cursor to col-resize on drag start and restores it on mouseup', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      const handle = document.querySelector('[style*="col-resize"]') as HTMLElement;

      fireEvent.mouseDown(handle, { clientX: 500 });
      expect(document.body.style.cursor).toBe('col-resize');

      fireEvent.mouseUp(document);
      expect(document.body.style.cursor).toBe('');
    });

    it('disables text selection on drag start and restores it on mouseup', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      const handle = document.querySelector('[style*="col-resize"]') as HTMLElement;

      fireEvent.mouseDown(handle, { clientX: 500 });
      expect(document.body.style.userSelect).toBe('none');

      fireEvent.mouseUp(document);
      expect(document.body.style.userSelect).toBe('');
    });

    it('clamps width to the minimum (240 px) when dragging far right', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      const handle = document.querySelector('[style*="col-resize"]') as HTMLElement;

      // dragStartX = 100, width = 360 initially.
      // Moving to clientX = 700 → delta = 100 - 700 = -600 → width = 360 - 600 = -240 → clamped to 240.
      fireEvent.mouseDown(handle, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 700 });

      const outer = handle.parentElement as HTMLElement;
      expect(parseInt(outer.style.width, 10)).toBe(240);
    });

    it('clamps width to the maximum (800 px) when dragging far left', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      const handle = document.querySelector('[style*="col-resize"]') as HTMLElement;

      // dragStartX = 900, width = 360 initially.
      // Moving to clientX = 100 → delta = 900 - 100 = 800 → width = 360 + 800 = 1160 → clamped to 800.
      fireEvent.mouseDown(handle, { clientX: 900 });
      fireEvent.mouseMove(document, { clientX: 100 });

      const outer = handle.parentElement as HTMLElement;
      expect(parseInt(outer.style.width, 10)).toBe(800);
    });
  });

  // ── 9. Header metadata ──────────────────────────────────────────────────

  describe('header', () => {
    it('displays the active model name', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      // Our @lib/ai-client/defaults mock returns 'test-model'.
      expect(screen.getByText('test-model')).toBeInTheDocument();
    });

    it('shows the context token count in the input footer', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.getByText(/tokens in context/)).toBeInTheDocument();
    });
  });

  // ── 10. Keyboard shortcut (Ctrl+Shift+D) ────────────────────────────────

  describe('Ctrl+Shift+D keyboard shortcut', () => {
    it('opens the sidebar from the closed non-embedded state', () => {
      render(<DiagnosticsChatSidebar {...defaultProps} />);
      expect(screen.queryByText('Debate Chat')).not.toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });

      expect(screen.getByText('Debate Chat')).toBeInTheDocument();
    });

    it('toggles the sidebar closed from the open state', () => {
      // Start open via embedded so we can test the close toggle without clicking
      // through the floating button first.
      render(<DiagnosticsChatSidebar {...defaultProps} embedded />);
      expect(screen.getByText('Debate Chat')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'D', ctrlKey: true, shiftKey: true });

      // After toggle: embedded + open=false → component returns null.
      expect(screen.queryByText('Debate Chat')).not.toBeInTheDocument();
    });
  });
});
