import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    hasApiKey: vi.fn().mockResolvedValue(false),
    addApiKey: vi.fn().mockResolvedValue({ count: 1 }),
    getApiKeys: vi.fn().mockResolvedValue([]),
    removeApiKey: vi.fn().mockResolvedValue(undefined),
    deleteAllApiKeys: vi.fn().mockResolvedValue(undefined),
    refreshAIModels: vi.fn().mockResolvedValue({ gemini: { ok: true, count: 3 }, claude: { ok: true, count: 2 }, groq: { ok: true, count: 1 }, openai: { ok: true, count: 1 }, deepseek: { ok: true, count: 1 }, ollama: { ok: true, count: 0 }, totalModels: 8 }),
    openExternal: vi.fn(),
  },
}));

vi.mock('@bridge', () => ({ api: mockApi }));
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

let mockDescMode: 'formal' | 'plain' = 'plain';
const mockSetDescMode = vi.fn();
vi.mock('../shared/DescriptionToggle', () => ({
  useDescriptionMode: () => [mockDescMode, mockSetDescMode] as const,
}));

const mockSetColorScheme = vi.fn();
const mockSetAIBackend = vi.fn();
const mockSetGeminiModel = vi.fn();
const mockSetPaneSpacing = vi.fn();

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: () => ({
    colorScheme: 'harvard' as const,
    setColorScheme: mockSetColorScheme,
    paneSpacing: 'normal' as const,
    setPaneSpacing: mockSetPaneSpacing,
    aiBackend: 'gemini' as const,
    setAIBackend: mockSetAIBackend,
    geminiModel: 'gemini-3.1-flash-lite-preview' as const,
    setGeminiModel: mockSetGeminiModel,
  }),
  AI_BACKENDS: [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'claude', label: 'Anthropic Claude' },
    { value: 'groq', label: 'Groq' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'ollama', label: 'Ollama' },
  ],
  MODELS_BY_BACKEND: {
    gemini: [
      { value: 'gemini-3.1-flash-lite-preview', label: '3.1 Flash Lite Preview' },
      { value: 'gemini-3-flash-preview', label: '3 Flash Preview' },
    ],
    claude: [{ value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }],
    groq: [{ value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' }],
    openai: [{ value: 'gpt-4o', label: 'GPT-4o' }],
    deepseek: [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }],
    ollama: [{ value: 'llama3', label: 'LLaMA 3' }],
  },
  initAIModels: vi.fn().mockResolvedValue(undefined),
}));

import { SettingsDialog } from './SettingsDialog';

describe('SettingsDialog', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDescMode = 'plain';
  });

  it('renders with heading and all setting sections', () => {
    render(<SettingsDialog onClose={onClose} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('AI Backend')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Pane 2 Item Spacing')).toBeInTheDocument();
    expect(screen.getByText('Description Display')).toBeInTheDocument();
  });

  it('renders backend options in the AI Backend select', () => {
    render(<SettingsDialog onClose={onClose} />);
    const backendSelect = screen.getAllByRole('combobox')[0];
    const options = Array.from(backendSelect.querySelectorAll('option'));
    expect(options.map(o => o.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Google Gemini'),
        expect.stringContaining('Anthropic Claude'),
      ]),
    );
  });

  it('renders theme options', () => {
    render(<SettingsDialog onClose={onClose} />);
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Harvard')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={onClose} />);
    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking the overlay', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsDialog onClose={onClose} />);
    const overlay = container.querySelector('.dialog-overlay')!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('changes theme when a new option is selected', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={onClose} />);
    const selects = screen.getAllByRole('combobox');
    const themeSelect = selects.find(s =>
      Array.from(s.querySelectorAll('option')).some(o => o.textContent === 'Dark'),
    )!;
    await user.selectOptions(themeSelect, 'dark');
    expect(mockSetColorScheme).toHaveBeenCalledWith('dark');
  });

  it('renders description mode radio buttons with correct selection', () => {
    render(<SettingsDialog onClose={onClose} />);
    const plainRadio = screen.getByRole('radio', { name: 'Plain' });
    const formalRadio = screen.getByRole('radio', { name: 'Formal' });
    expect(plainRadio).toBeChecked();
    expect(formalRadio).not.toBeChecked();
  });

  it('saves API key and shows success message', async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={onClose} />);
    const keyInput = screen.getByPlaceholderText('AIza...');
    await user.type(keyInput, 'AIzaSyTestKey');
    await user.click(screen.getByText('Save'));
    expect(mockApi.addApiKey).toHaveBeenCalledWith('AIzaSyTestKey', 'gemini');
    expect(await screen.findByText(/key saved/i)).toBeInTheDocument();
  });
});
