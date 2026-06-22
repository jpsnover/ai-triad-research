// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineageTermsView, VocabTermCard, VocabTermsView } from './VocabularyPanel';
import type { VocabResolution } from '../../utils/vocabularyAnnotations';

// ── Mocks ────────────────────────────────────────────────────

const mockExtractLineageNames = vi.fn<[string], string[]>();
vi.mock('../../utils/lineageMatcher', () => ({
  extractLineageNames: (text: string) => mockExtractLineageNames(text),
}));

const mockGetLineageInfo = vi.fn<[string], { summary?: string } | undefined>();
const mockGetAllLineages = vi.fn<[], Record<string, { summary?: string }>>().mockReturnValue({});
vi.mock('../../data/lineageLookup', () => ({
  getLineageInfo: (name: string) => mockGetLineageInfo(name),
  getAllLineages: () => mockGetAllLineages(),
}));

const mockNavigateToLineage = vi.fn();
let mockVocabTerms: unknown[] | undefined = undefined;
let mockStdTerms: unknown[] | undefined = undefined;

vi.mock('../../hooks/useDebateStore', () => ({
  useDebateStore: (selector: (s: { vocabularyTerms?: { colloquial?: unknown[]; standardized?: unknown[] } }) => unknown) =>
    selector({ vocabularyTerms: { colloquial: mockVocabTerms, standardized: mockStdTerms } }),
}));

vi.mock('../../hooks/useTaxonomyStore', () => ({
  useTaxonomyStore: (selector: (s: { navigateToLineage: typeof mockNavigateToLineage }) => unknown) =>
    selector({ navigateToLineage: mockNavigateToLineage }),
}));

vi.mock('./utils', () => ({
  POV_COLOR_VAR: {
    accelerationist: 'var(--color-acc)',
    safetyist: 'var(--color-saf)',
    skeptic: 'var(--color-skp)',
    situations: 'var(--color-sit)',
  },
}));

// ── LineageTermsView ─────────────────────────────────────────

describe('LineageTermsView', () => {
  beforeEach(() => {
    mockExtractLineageNames.mockReset();
    mockGetLineageInfo.mockReset();
  });

  it('renders "No lineage references found" when no names are extracted', () => {
    mockExtractLineageNames.mockReturnValue([]);
    render(<LineageTermsView content="Some neutral text" />);
    expect(screen.getByText('No lineage references found')).toBeInTheDocument();
  });

  it('renders singular reference count for one name', () => {
    mockExtractLineageNames.mockReturnValue(['Kantian Ethics']);
    mockGetLineageInfo.mockReturnValue(undefined);
    render(<LineageTermsView content="Kantian Ethics text" />);
    expect(screen.getByText('1 lineage reference')).toBeInTheDocument();
  });

  it('renders plural reference count for multiple names', () => {
    mockExtractLineageNames.mockReturnValue(['Utilitarianism', 'Kantian Ethics']);
    mockGetLineageInfo.mockReturnValue(undefined);
    render(<LineageTermsView content="Some philosophical text" />);
    expect(screen.getByText('2 lineage references')).toBeInTheDocument();
  });

  it('renders each lineage name', () => {
    mockExtractLineageNames.mockReturnValue(['Utilitarianism', 'Kantian Ethics']);
    mockGetLineageInfo.mockReturnValue(undefined);
    render(<LineageTermsView content="Some text" />);
    expect(screen.getByText('Utilitarianism')).toBeInTheDocument();
    expect(screen.getByText('Kantian Ethics')).toBeInTheDocument();
  });

  it('renders the summary when getLineageInfo returns one', () => {
    mockExtractLineageNames.mockReturnValue(['Utilitarianism']);
    mockGetLineageInfo.mockReturnValue({ summary: 'Greatest happiness principle.' });
    render(<LineageTermsView content="Utilitarian text" />);
    expect(screen.getByText('Greatest happiness principle.')).toBeInTheDocument();
  });

  it('does not render summary when getLineageInfo returns undefined', () => {
    mockExtractLineageNames.mockReturnValue(['Kantianism']);
    mockGetLineageInfo.mockReturnValue(undefined);
    const { container } = render(<LineageTermsView content="Kantian text" />);
    // Only the name div should be present, no summary paragraph
    expect(container.querySelectorAll('div > div > div').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Greatest happiness principle.')).not.toBeInTheDocument();
  });

  it('upgrades content-less term to content-rich alternative sharing the same stem', () => {
    mockExtractLineageNames.mockReturnValue(['regulatory sandboxes']);
    mockGetLineageInfo.mockImplementation((name: string) =>
      name === 'regulatory sandbox concept' ? { summary: 'A controlled environment...' } : undefined,
    );
    mockGetAllLineages.mockReturnValue({
      'regulatory sandbox concept': { summary: 'A controlled environment...' },
      'regulatory sandbox framework': { summary: 'A framework for...' },
    });
    render(<LineageTermsView content="regulatory sandboxes text" />);
    expect(screen.getByText('regulatory sandbox concept')).toBeInTheDocument();
    expect(screen.getByText('A controlled environment...')).toBeInTheDocument();
    expect(screen.queryByText('regulatory sandboxes')).not.toBeInTheDocument();
  });
});

// ── VocabTermCard ─────────────────────────────────────────────

describe('VocabTermCard', () => {
  beforeEach(() => {
    mockNavigateToLineage.mockReset();
  });

  it('renders the colloquial term', () => {
    render(
      <VocabTermCard
        bare="AGI"
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('AGI')).toBeInTheDocument();
  });

  it('renders resolution links when dict is provided', () => {
    const dict = {
      resolves_to: [
        { standardized_term: 'artificial_general_intelligence', when: 'in technical contexts', default_for_camp: undefined },
      ],
    };
    render(
      <VocabTermCard
        bare="AGI"
        dict={dict}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('artificial_general_intelligence')).toBeInTheDocument();
    expect(screen.getByText('in technical contexts')).toBeInTheDocument();
  });

  it('renders display form from defLookup when available', () => {
    const dict = {
      resolves_to: [
        { standardized_term: 'agi', when: 'broadly', default_for_camp: undefined },
      ],
    };
    const defLookup = new Map([['agi', { display: 'Artificial General Intelligence', definition: 'A hypothetical AI...' }]]);
    render(
      <VocabTermCard
        bare="AGI"
        dict={dict}
        defLookup={defLookup}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('Artificial General Intelligence')).toBeInTheDocument();
  });

  it('renders definition from defLookup when available', () => {
    const dict = {
      resolves_to: [
        { standardized_term: 'agi', when: 'broadly', default_for_camp: undefined },
      ],
    };
    const defLookup = new Map([['agi', { display: 'AGI', definition: 'A hypothetical AI system.' }]]);
    render(
      <VocabTermCard
        bare="AGI"
        dict={dict}
        defLookup={defLookup}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('A hypothetical AI system.')).toBeInTheDocument();
  });

  it('renders default_for_camp label when provided', () => {
    const dict = {
      resolves_to: [
        { standardized_term: 'agi', when: 'broadly', default_for_camp: 'accelerationist' },
      ],
    };
    render(
      <VocabTermCard
        bare="AGI"
        dict={dict}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('accelerationist')).toBeInTheDocument();
  });

  it('calls navigateToLineage when a resolution link is clicked', async () => {
    const dict = {
      resolves_to: [
        { standardized_term: 'agi', when: 'broadly', default_for_camp: undefined },
      ],
    };
    render(
      <VocabTermCard
        bare="AGI"
        dict={dict}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    await userEvent.click(screen.getByText('agi'));
    expect(mockNavigateToLineage).toHaveBeenCalledWith('agi');
  });

  it('renders fallback resolution link when dict is absent but resolved is provided', () => {
    render(
      <VocabTermCard
        bare="alignment"
        resolved="ai_alignment"
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText('ai_alignment')).toBeInTheDocument();
  });

  it('calls navigateToLineage with the resolved term when fallback link is clicked', async () => {
    render(
      <VocabTermCard
        bare="alignment"
        resolved="ai_alignment"
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    await userEvent.click(screen.getByText('ai_alignment'));
    expect(mockNavigateToLineage).toHaveBeenCalledWith('ai_alignment');
  });

  it('renders ambiguous_when text when provided', () => {
    const dict = {
      resolves_to: [{ standardized_term: 'safety', when: 'broadly', default_for_camp: undefined }],
      ambiguous_when: ['discussing different risk models'],
    };
    render(
      <VocabTermCard
        bare="safety"
        dict={dict}
        navigateToLineage={mockNavigateToLineage}
      />,
    );
    expect(screen.getByText(/discussing different risk models/)).toBeInTheDocument();
  });
});

// ── VocabTermsView ────────────────────────────────────────────

describe('VocabTermsView', () => {
  beforeEach(() => {
    mockVocabTerms = undefined;
    mockStdTerms = undefined;
    mockNavigateToLineage.mockReset();
  });

  it('renders singular "1 term resolved" for a single resolution', () => {
    const resolutions: VocabResolution[] = [
      { colloquial: 'AGI', canonical: 'artificial_general_intelligence', offset: 0 },
    ];
    render(<VocabTermsView resolutions={resolutions} />);
    expect(screen.getByText(/1 term resolved/)).toBeInTheDocument();
  });

  it('renders plural term count for multiple resolutions', () => {
    const resolutions: VocabResolution[] = [
      { colloquial: 'AGI', canonical: 'agi', offset: 0 },
      { colloquial: 'alignment', canonical: 'ai_alignment', offset: 10 },
    ];
    render(<VocabTermsView resolutions={resolutions} />);
    expect(screen.getByText(/2 terms resolved/)).toBeInTheDocument();
  });

  it('deduplicates resolutions with the same colloquial term', () => {
    const resolutions: VocabResolution[] = [
      { colloquial: 'AGI', canonical: 'agi', offset: 0 },
      { colloquial: 'AGI', canonical: 'agi', offset: 20 },
    ];
    render(<VocabTermsView resolutions={resolutions} />);
    expect(screen.getByText(/1 term resolved/)).toBeInTheDocument();
  });

  it('renders each unique term card', () => {
    const resolutions: VocabResolution[] = [
      { colloquial: 'AGI', canonical: 'agi', offset: 0 },
      { colloquial: 'alignment', canonical: 'ai_alignment', offset: 10 },
    ];
    render(<VocabTermsView resolutions={resolutions} />);
    expect(screen.getByText('AGI')).toBeInTheDocument();
    expect(screen.getByText('alignment')).toBeInTheDocument();
  });

  it('shows ambiguity count when ambiguities are provided', () => {
    const resolutions: VocabResolution[] = [
      { colloquial: 'safety', canonical: 'ai_safety', offset: 0 },
    ];
    const ambiguities = [{ colloquial: 'control', offset: 5 }];
    render(<VocabTermsView resolutions={resolutions} ambiguities={ambiguities} />);
    expect(screen.getByText(/1 ambiguous/)).toBeInTheDocument();
  });

  it('renders ambiguous term cards in the ambiguity section', () => {
    const resolutions: VocabResolution[] = [];
    const ambiguities = [
      { colloquial: 'control', offset: 5 },
      { colloquial: 'alignment', offset: 20 },
    ];
    render(<VocabTermsView resolutions={resolutions} ambiguities={ambiguities} />);
    expect(screen.getByText('control')).toBeInTheDocument();
    expect(screen.getByText('alignment')).toBeInTheDocument();
  });

  it('enriches terms from vocabTerms store when available', () => {
    mockVocabTerms = [
      {
        colloquial_term: 'AGI',
        resolves_to: [{ standardized_term: 'agi', when: 'broadly', default_for_camp: undefined }],
        translation_ambiguous_when: [],
      },
    ];
    const resolutions: VocabResolution[] = [
      { colloquial: 'AGI', canonical: 'agi', offset: 0 },
    ];
    render(<VocabTermsView resolutions={resolutions} />);
    // The dict data from vocabTerms should appear (standardized term link)
    expect(screen.getByText('agi')).toBeInTheDocument();
  });
});
