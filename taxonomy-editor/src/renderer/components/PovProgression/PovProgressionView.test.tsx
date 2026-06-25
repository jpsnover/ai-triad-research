import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PovProgressionView } from './PovProgressionView';
import type { DebateSession, TranscriptEntry } from '../../types/debate';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

function makeEntry(overrides: Partial<TranscriptEntry> & { id: string; speaker: string; type: string }): TranscriptEntry {
  return {
    content: 'Test content',
    taxonomy_refs: [],
    timestamp: '2026-01-01T00:00:00Z',
    metadata: {},
    ...overrides,
  } as TranscriptEntry;
}

function makeSession(overrides: Partial<DebateSession> = {}): DebateSession {
  return {
    id: 'test-debate',
    title: 'Test Debate',
    topic: 'AI Safety',
    status: 'completed',
    transcript: [],
    argument_network: { nodes: [], edges: [] },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as DebateSession;
}

describe('PovProgressionView', () => {
  it('shows placeholder when no session is provided', () => {
    render(<PovProgressionView session={null} nodeLabels={new Map()} />);
    expect(screen.getByText(/No active debate/)).toBeDefined();
  });

  it('shows empty-turns message for a session with no transcript', () => {
    const session = makeSession({ transcript: [] });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    expect(screen.getByText(/Debate has no turns yet/)).toBeDefined();
  });

  it('renders the Perspective Progression header', () => {
    const session = makeSession({
      transcript: [
        makeEntry({ id: 'e1', speaker: 'accelerationist', type: 'opening' }),
        makeEntry({ id: 'e2', speaker: 'safetyist', type: 'opening' }),
        makeEntry({ id: 'e3', speaker: 'skeptic', type: 'opening' }),
      ],
    });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    expect(screen.getByText('Perspective Progression')).toBeDefined();
  });

  it('renders Opening turn buttons', () => {
    const session = makeSession({
      transcript: [
        makeEntry({ id: 'e1', speaker: 'accelerationist', type: 'opening' }),
      ],
    });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    const openingButtons = screen.getAllByText('Opening');
    expect(openingButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders mode buttons (diff, snapshot, vs Opening)', () => {
    const session = makeSession({
      transcript: [
        makeEntry({ id: 'e1', speaker: 'accelerationist', type: 'opening' }),
      ],
    });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    expect(screen.getByText('diff')).toBeDefined();
    expect(screen.getByText('snapshot')).toBeDefined();
    expect(screen.getByText('vs Opening')).toBeDefined();
  });

  it('renders POV lane labels for all three perspectives', () => {
    const session = makeSession({
      transcript: [
        makeEntry({ id: 'e1', speaker: 'accelerationist', type: 'opening' }),
        makeEntry({ id: 'e2', speaker: 'safetyist', type: 'opening' }),
        makeEntry({ id: 'e3', speaker: 'skeptic', type: 'opening' }),
      ],
    });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    expect(screen.getAllByText('Accelerationist').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Safetyist').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Skeptic').length).toBeGreaterThanOrEqual(1);
  });

  it('renders multiple turns when debate has rounds', () => {
    const session = makeSession({
      transcript: [
        makeEntry({ id: 'e1', speaker: 'accelerationist', type: 'opening' }),
        makeEntry({ id: 'e2', speaker: 'safetyist', type: 'opening' }),
        makeEntry({ id: 'e3', speaker: 'skeptic', type: 'opening' }),
        makeEntry({ id: 'e4', speaker: 'accelerationist', type: 'statement', metadata: { round: 1 } }),
        makeEntry({ id: 'e5', speaker: 'safetyist', type: 'statement', metadata: { round: 1 } }),
        makeEntry({ id: 'e6', speaker: 'skeptic', type: 'statement', metadata: { round: 1 } }),
      ],
    });
    render(<PovProgressionView session={session} nodeLabels={new Map()} />);
    const openingEls = screen.getAllByText('Opening');
    const round1Els = screen.getAllByText('Round 1');
    expect(openingEls.length).toBeGreaterThanOrEqual(1);
    expect(round1Els.length).toBeGreaterThanOrEqual(1);
  });
});
