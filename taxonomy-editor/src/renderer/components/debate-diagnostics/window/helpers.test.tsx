// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@lib/debate/types', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lib/debate/types')>();
  return {
    ...original,
    POVER_INFO: {
      accelerationist: { label: 'Accelerationist', pov: 'accelerationist' },
      safetyist:       { label: 'Safetyist', pov: 'safetyist' },
      skeptic:         { label: 'Skeptic', pov: 'skeptic' },
    },
  };
});
vi.mock('@lib/debate/soul-docs/accelerationist.soul.json', () => ({ default: { label: 'Accelerationist' } }));
vi.mock('@lib/debate/soul-docs/safetyist.soul.json',       () => ({ default: { label: 'Safetyist' } }));
vi.mock('@lib/debate/soul-docs/skeptic.soul.json',         () => ({ default: { label: 'Skeptic' } }));
vi.mock('@bridge', () => ({
  api: { clipboardWriteText: vi.fn().mockResolvedValue(undefined) },
}));

import {
  speakerLabel,
  countMatches,
  Highlight,
  TrafficLight,
  AifBadge,
  ResizablePre,
} from './helpers';

// ---------------------------------------------------------------------------
// speakerLabel
// ---------------------------------------------------------------------------
describe('speakerLabel', () => {
  it("returns 'Accelerationist' for 'accelerationist'", () => {
    expect(speakerLabel('accelerationist')).toBe('Accelerationist');
  });

  it("returns 'System' for 'system'", () => {
    expect(speakerLabel('system')).toBe('System');
  });

  it("returns 'Moderator' for 'moderator'", () => {
    expect(speakerLabel('moderator')).toBe('Moderator');
  });

  it("returns 'User' for 'user'", () => {
    expect(speakerLabel('user')).toBe('User');
  });

  it('returns raw string for unknown speaker', () => {
    expect(speakerLabel('unknown-agent')).toBe('unknown-agent');
  });
});

// ---------------------------------------------------------------------------
// countMatches
// ---------------------------------------------------------------------------
describe('countMatches', () => {
  it('returns 0 for empty query', () => {
    expect(countMatches('some text', '')).toBe(0);
  });

  it('returns 0 for empty text', () => {
    expect(countMatches('', 'query')).toBe(0);
  });

  it('returns 0 for no match', () => {
    expect(countMatches('hello world', 'xyz')).toBe(0);
  });

  it('returns 1 for single match', () => {
    expect(countMatches('hello world', 'world')).toBe(1);
  });

  it('returns 3 for multiple matches (case insensitive)', () => {
    expect(countMatches('foo bar foo baz foo', 'foo')).toBe(3);
  });

  it("case insensitive: 'ABC' in 'abc ABC Abc' = 3", () => {
    expect(countMatches('abc ABC Abc', 'ABC')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------
describe('Highlight', () => {
  it('renders plain text when no query', () => {
    const { container } = render(<Highlight text="hello world" />);
    expect(container.textContent).toBe('hello world');
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });

  it('renders mark elements for matches', () => {
    const { container } = render(<Highlight text="hello world hello" query="hello" />);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('hello');
    expect(marks[1].textContent).toBe('hello');
  });

  it('case-insensitive highlighting', () => {
    const { container } = render(<Highlight text="Hello HELLO hello" query="hello" />);
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// TrafficLight
// ---------------------------------------------------------------------------
describe('TrafficLight', () => {
  it('renders green dot and label when pass=true', () => {
    const { container } = render(<TrafficLight pass={true} label="OK" />);
    expect(container.textContent).toContain('OK');
    const dot = container.querySelector('span span') as HTMLElement;
    expect(dot.style.background).toBe('rgb(34, 197, 94)'); // #22c55e
  });

  it('renders red dot and label when pass=false', () => {
    const { container } = render(<TrafficLight pass={false} label="Fail" />);
    expect(container.textContent).toContain('Fail');
    const dot = container.querySelector('span span') as HTMLElement;
    expect(dot.style.background).toBe('rgb(239, 68, 68)'); // #ef4444
  });
});

// ---------------------------------------------------------------------------
// AifBadge
// ---------------------------------------------------------------------------
describe('AifBadge', () => {
  it('renders with correct type text', () => {
    const { container } = render(<AifBadge type="I-node" />);
    expect(container.textContent).toBe('I-node');
  });

  it('renders custom label when provided', () => {
    const { container } = render(<AifBadge type="CA-node" label="Attack" />);
    expect(container.textContent).toBe('Attack');
  });
});

// ---------------------------------------------------------------------------
// ResizablePre
// ---------------------------------------------------------------------------
describe('ResizablePre', () => {
  it('renders textarea with provided text', () => {
    render(<ResizablePre text="sample content" />);
    const textarea = screen.getByDisplayValue('sample content');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('readonly');
  });
});
