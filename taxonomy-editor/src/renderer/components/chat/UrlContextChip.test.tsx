// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UrlContextChip } from './UrlContextChip';
import type { UrlContextMetadata } from '@lib/ai-client';

describe('UrlContextChip', () => {
  it('renders nothing when urlMetadata is empty', () => {
    const meta: UrlContextMetadata = { urlMetadata: [] };
    const { container } = render(<UrlContextChip metadata={meta} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a success chip showing the hostname', () => {
    const meta: UrlContextMetadata = {
      urlMetadata: [{ retrievedUrl: 'https://example.com/article', urlRetrievalStatus: 'SUCCESS' }],
    };
    render(<UrlContextChip metadata={meta} />);
    const chip = screen.getByText('read: example.com');
    expect(chip).toBeTruthy();
    expect(chip.className).not.toContain('url-context-chip--failed');
    expect(chip.getAttribute('title')).toBe('Read: https://example.com/article');
  });

  it('renders a failed chip with --failed modifier and honest-fail title', () => {
    const meta: UrlContextMetadata = {
      urlMetadata: [{ retrievedUrl: 'https://restricted.gov/page', urlRetrievalStatus: 'ERROR_BLOCKED' }],
    };
    render(<UrlContextChip metadata={meta} />);
    const chip = screen.getByText("couldn't read: restricted.gov");
    expect(chip.className).toContain('url-context-chip--failed');
    expect(chip.getAttribute('title')).toBe("Couldn't read: https://restricted.gov/page");
  });

  it('renders multiple chips — one per URL entry', () => {
    const meta: UrlContextMetadata = {
      urlMetadata: [
        { retrievedUrl: 'https://first.org/', urlRetrievalStatus: 'SUCCESS' },
        { retrievedUrl: 'https://second.io/path', urlRetrievalStatus: 'SUCCESS' },
        { retrievedUrl: 'https://third.net/', urlRetrievalStatus: 'ERROR_TIMEOUT' },
      ],
    };
    render(<UrlContextChip metadata={meta} />);
    expect(screen.getByText('read: first.org')).toBeTruthy();
    expect(screen.getByText('read: second.io')).toBeTruthy();
    expect(screen.getByText("couldn't read: third.net")).toBeTruthy();
  });

  it('falls back to the raw URL when the URL is malformed', () => {
    const meta: UrlContextMetadata = {
      urlMetadata: [{ retrievedUrl: 'not-a-url', urlRetrievalStatus: 'SUCCESS' }],
    };
    render(<UrlContextChip metadata={meta} />);
    expect(screen.getByText('read: not-a-url')).toBeTruthy();
  });
});

describe('chatSystemPrompt urlContext param', () => {
  it('includes honest-fail text when urlContext is false (default)', async () => {
    const { chatSystemPrompt } = await import('../../prompts/chat');
    const prompt = chatSystemPrompt('Label', 'pov', 'personality', 'inform', 'topic', 'ctx');
    expect(prompt).toContain("you have not visited that URL");
    expect(prompt).toContain("HANDLING LINKS");
    expect(prompt).not.toContain("url_context tool");
  });

  it('includes grounding text when urlContext is true', async () => {
    const { chatSystemPrompt } = await import('../../prompts/chat');
    const prompt = chatSystemPrompt('Label', 'pov', 'personality', 'inform', 'topic', 'ctx', true);
    expect(prompt).toContain("url_context tool");
    expect(prompt).toContain("ground your response");
    expect(prompt).not.toContain("you have not visited that URL");
  });
});
