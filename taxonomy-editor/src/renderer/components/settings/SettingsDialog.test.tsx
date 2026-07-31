import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    getAvailableBackends: vi.fn().mockResolvedValue([
      { id: 'gemini', available: true },
      { id: 'claude', available: true },
      { id: 'groq', available: true },
    ]),
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
    geminiModel: 'gemini-3.5-flash-lite-preview' as const,
    setGeminiModel: mockSetGeminiModel,
  }),
  AI_BACKENDS: [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'claude', label: 'Anthropic Claude' },
    { value: 'groq', label: 'Groq' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'ollama', label: 'Ollama' },
    { value: 'azure', label: 'Azure OpenAI' },
    { value: 'moonshot', label: 'Moonshot' },
  ],
  MODELS_BY_BACKEND: {
    gemini: [
      { value: 'gemini-3.5-flash-lite-preview', label: '3.1 Flash Lite Preview' },
      { value: 'gemini-3-flash-preview', label: '3 Flash Preview' },
    ],
    claude: [{ value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }],
    groq: [{ value: 'llama-3.3-70b-versatile', label: 'LLaMA 3.3 70B' }],
    openai: [{ value: 'gpt-4o', label: 'GPT-4o' }],
    deepseek: [{ value: 'deepseek-chat', label: 'DeepSeek Chat' }],
    ollama: [{ value: 'llama3', label: 'LLaMA 3' }],
    azure: [{ value: 'gpt-4o-azure', label: 'GPT-4o (Azure)' }],
    moonshot: [{ value: 'kimi-k2', label: 'Kimi K2' }],
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

  it('de-conflates the 3 backend states — has-key plain, no-key selectable BYOK, tier-restricted honest (t/2036)', async () => {
    mockApi.getAvailableBackends.mockResolvedValueOnce([
      { id: 'gemini', available: true },                            // #1 has key + tier-ok
      { id: 'moonshot', available: false, reason: 'no_key' },       // #2 BYOK-permitted, no key
      { id: 'azure', available: false, reason: 'tier_restricted' }, // #3 tier forbids BYOK
    ]);
    render(<SettingsDialog onClose={onClose} />);
    const backendSelect = screen.getAllByRole('combobox')[0];
    // #3 — restricted + honest label, and (the bug) NOT disabled-away as "(not on your tier)"
    const azure = await within(backendSelect).findByRole('option', { name: 'Azure OpenAI (sign in to use)' });
    expect(azure).toBeDisabled();
    // #2 — the key regression: a keyless BYOK-permitted backend stays SELECTABLE
    const moonshot = within(backendSelect).getByRole('option', { name: 'Moonshot (bring your own key)' });
    expect(moonshot).not.toBeDisabled();
    // #1 — plain, no suffix
    const gemini = within(backendSelect).getByRole('option', { name: 'Google Gemini' });
    expect(gemini).not.toBeDisabled();
  });
});
