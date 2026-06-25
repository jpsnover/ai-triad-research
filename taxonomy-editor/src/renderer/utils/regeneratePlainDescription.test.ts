import { describe, it, expect, vi, beforeEach } from 'vitest';
import { regeneratePlainDescription, triggerPovNodeRegeneration, triggerSituationNodeRegeneration } from './regeneratePlainDescription';

const mockGenerateText = vi.fn();
vi.mock('@bridge', () => ({ api: { generateText: (...args: unknown[]) => mockGenerateText(...args) } }));
vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

describe('regeneratePlainDescription', () => {
  let updateNode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateNode = vi.fn();
    mockGenerateText.mockReset();
  });

  it('generates plain description via AI', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Plain version of description.' });
    await regeneratePlainDescription('acc-beliefs-001', 'A formal DOLCE description that is long enough', updateNode);
    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(updateNode).toHaveBeenCalledWith({
      plain_description: 'Plain version of description.',
      plain_description_version: 'flash-lite:v1',
    });
  });

  it('skips generation for short descriptions', async () => {
    await regeneratePlainDescription('acc-beliefs-001', 'Short', updateNode);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith({ plain_description: 'Short', plain_description_version: null });
  });

  it('skips generation for deprecated nodes', async () => {
    await regeneratePlainDescription('acc-beliefs-001', '[DEPRECATED] Some old description text here', updateNode);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith({ plain_description: '[DEPRECATED] Some old description text here', plain_description_version: null });
  });

  it('skips generation for empty descriptions', async () => {
    await regeneratePlainDescription('acc-beliefs-001', '', updateNode);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(updateNode).toHaveBeenCalledWith({ plain_description: null, plain_description_version: null });
  });

  it('handles generation failure gracefully', async () => {
    mockGenerateText.mockRejectedValue(new Error('API error'));
    await regeneratePlainDescription('acc-beliefs-001', 'A formal DOLCE description that is long enough', updateNode);
    expect(updateNode).not.toHaveBeenCalled();
  });

  it('trims whitespace from generated text', async () => {
    mockGenerateText.mockResolvedValue({ text: '  Padded text.  \n' });
    await regeneratePlainDescription('acc-beliefs-001', 'A formal DOLCE description that is long enough', updateNode);
    expect(updateNode).toHaveBeenCalledWith({
      plain_description: 'Padded text.',
      plain_description_version: 'flash-lite:v1',
    });
  });
});

describe('triggerPovNodeRegeneration', () => {
  it('calls updatePovNode with correct pov and nodeId', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Plain text.' });
    const updatePovNode = vi.fn();
    triggerPovNodeRegeneration('acc', 'acc-beliefs-001', 'A formal DOLCE description that is long enough', updatePovNode);
    await vi.waitFor(() => expect(updatePovNode).toHaveBeenCalled());
    expect(updatePovNode).toHaveBeenCalledWith('acc', 'acc-beliefs-001', {
      plain_description: 'Plain text.',
      plain_description_version: 'flash-lite:v1',
    });
  });
});

describe('triggerSituationNodeRegeneration', () => {
  it('calls updateSituationNode with correct nodeId', async () => {
    mockGenerateText.mockResolvedValue({ text: 'Plain text.' });
    const updateSitNode = vi.fn();
    triggerSituationNodeRegeneration('sit-001', 'A formal DOLCE description that is long enough', updateSitNode);
    await vi.waitFor(() => expect(updateSitNode).toHaveBeenCalled());
    expect(updateSitNode).toHaveBeenCalledWith('sit-001', {
      plain_description: 'Plain text.',
      plain_description_version: 'flash-lite:v1',
    });
  });
});
