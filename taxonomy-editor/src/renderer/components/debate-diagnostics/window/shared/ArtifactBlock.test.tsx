// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactBlock } from './ArtifactBlock';

vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn() },
}));

describe('ArtifactBlock', () => {
  const sampleText = 'line one\nline two\nline three';

  it('renders collapsed by default with line count and label', () => {
    render(<ArtifactBlock label="Raw Prompt" text={sampleText} />);
    expect(screen.getByText(/3 lines/)).toBeInTheDocument();
    expect(screen.getByText(/Raw Prompt/)).toBeInTheDocument();
    expect(screen.queryByText('line one')).not.toBeInTheDocument();
  });

  it('expands on click to show content', () => {
    const { container } = render(<ArtifactBlock label="Raw Response" text={sampleText} />);
    fireEvent.click(screen.getByRole('button', { name: /3 lines/ }));
    expect(container.querySelector('.artifact-block-content')).toBeInTheDocument();
    expect(container.querySelector('.artifact-block-content')!.textContent).toBe(sampleText);
  });

  it('renders expanded when defaultOpen is true', () => {
    const { container } = render(<ArtifactBlock label="Test" text={sampleText} defaultOpen />);
    expect(container.querySelector('.artifact-block-content')).toBeInTheDocument();
  });

  it('collapses when clicked again', () => {
    const { container } = render(<ArtifactBlock label="Test" text={sampleText} />);
    const header = screen.getByRole('button', { name: /3 lines/ });
    fireEvent.click(header);
    expect(container.querySelector('.artifact-block-content')).toBeInTheDocument();
    fireEvent.click(header);
    expect(container.querySelector('.artifact-block-content')).not.toBeInTheDocument();
  });

  it('shows a Copy button', () => {
    render(<ArtifactBlock label="Test" text={sampleText} />);
    expect(screen.getByTitle('Copy section content to clipboard')).toBeInTheDocument();
  });

  it('supports keyboard activation (Enter)', () => {
    const { container } = render(<ArtifactBlock label="Test" text={sampleText} />);
    const header = screen.getByRole('button', { name: /3 lines/ });
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(container.querySelector('.artifact-block-content')).toBeInTheDocument();
  });

  it('counts single-line text correctly', () => {
    render(<ArtifactBlock label="One" text="single line" />);
    expect(screen.getByText(/1 lines/)).toBeInTheDocument();
  });
});
