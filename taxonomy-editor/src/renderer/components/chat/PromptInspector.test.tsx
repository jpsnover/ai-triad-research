// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ────────────────────────────────────────────────

const { MOCK_CATALOG } = vi.hoisted(() => ({
  MOCK_CATALOG: [
    {
      id: 'opening',
      title: 'Opening Prompt',
      description: 'Generates opening statements',
      group: 'debate-setup',
      template: 'You are a {pover} debater discussing {topic}.',
      purpose: 'Kick off the debate with an opening statement.',
      source: 'prompts/debate.ts',
      phase: 'Setup',
      applicableDataSources: ['taxonomy'],
      promptFiles: undefined,
      psParameters: undefined,
    },
    {
      id: 'continuation',
      title: 'Continuation Prompt',
      description: 'Generates follow-up responses',
      group: 'debate-turns',
      template: 'Continue the debate on {topic}.',
      purpose: 'Generate follow-up responses in the debate.',
      source: 'prompts/debate.ts',
      phase: 'Turns',
      applicableDataSources: [],
      promptFiles: undefined,
      psParameters: undefined,
    },
  ],
}));

vi.mock('../../data/promptCatalog', () => ({
  PROMPT_CATALOG: MOCK_CATALOG,
}));

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeDebate: null, debateModel: 'test-model' }),
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({}),
  MODELS_BY_BACKEND: {
    gemini: [{ value: 'gemini-flash', label: 'Gemini Flash' }],
  },
}));

vi.mock('../../hooks/usePromptConfigStore', () => ({
  usePromptConfigStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sessionOverrides: {},
      workspaceDefaults: {},
      setSession: vi.fn(),
    }),
  PROMPT_CONFIG_DEFAULTS: { 'temperature.debate': 0.7 },
}));

vi.mock('../../utils/promptPreview', () => ({
  generatePromptPreview: vi.fn().mockReturnValue(null),
}));

vi.mock('@bridge', () => ({
  api: {
    readPsPrompt: vi.fn().mockResolvedValue({ text: 'mock prompt content' }),
  },
}));

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../shared/DataSourceCard', () => ({
  DataSourceCard: ({ dsId }: { dsId: string }) => (
    <div data-testid={`ds-card-${dsId}`}>{dsId}</div>
  ),
}));

import { PromptInspector } from './PromptInspector';

describe('PromptInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the prompt selector sidebar with grouped entries', () => {
    render(<PromptInspector />);
    expect(screen.getByText('Debate Setup')).toBeInTheDocument();
    expect(screen.getAllByText('Opening Prompt').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Debate Turns')).toBeInTheDocument();
    expect(screen.getByText('Continuation Prompt')).toBeInTheDocument();
  });

  it('selects the first prompt by default and shows its details', () => {
    render(<PromptInspector />);
    expect(screen.getAllByText('Opening Prompt').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Kick off the debate with an opening statement.')).toBeInTheDocument();
    expect(screen.getByText('prompts/debate.ts')).toBeInTheDocument();
  });

  it('switches selected prompt when another entry is clicked', async () => {
    render(<PromptInspector />);
    await userEvent.click(screen.getByText('Continuation Prompt'));
    expect(screen.getByText('Generate follow-up responses in the debate.')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<PromptInspector />);
    expect(screen.getByPlaceholderText(/Search by label/)).toBeInTheDocument();
  });

  it('filters entries by search query', async () => {
    render(<PromptInspector />);
    const searchInput = screen.getByPlaceholderText(/Search by label/);
    await userEvent.type(searchInput, 'Opening');
    expect(screen.getAllByText('Opening Prompt').length).toBeGreaterThan(0);
    expect(screen.queryByText('Continuation Prompt')).not.toBeInTheDocument();
  });

  it('clears search when clear button is clicked', async () => {
    render(<PromptInspector />);
    const searchInput = screen.getByPlaceholderText(/Search by label/);
    await userEvent.type(searchInput, 'Opening');
    expect(screen.queryByText('Continuation Prompt')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Clear search'));
    expect(screen.getByText('Continuation Prompt')).toBeInTheDocument();
  });

  it('shows template toggle button with token estimate', () => {
    render(<PromptInspector />);
    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByText(/tokens/)).toBeInTheDocument();
  });

  it('expands template text when toggle is clicked', async () => {
    render(<PromptInspector />);
    await userEvent.click(screen.getByText('Template'));
    expect(screen.getByText('{pover}')).toBeInTheDocument();
    expect(screen.getByText('{topic}')).toBeInTheDocument();
  });

  it('shows preview hint when no active debate session', () => {
    render(<PromptInspector />);
    expect(screen.getByText(/Start a debate or chat to see a live preview/)).toBeInTheDocument();
  });

  it('renders data source cards for prompts with applicable data sources', () => {
    render(<PromptInspector />);
    expect(screen.getByTestId('ds-card-taxonomy')).toBeInTheDocument();
  });

  it('toggles search mode between Label and Content', async () => {
    render(<PromptInspector />);
    const contentButton = screen.getByText('Content');
    await userEvent.click(contentButton);
    expect(screen.getByPlaceholderText(/Search prompt content/)).toBeInTheDocument();
  });
});
