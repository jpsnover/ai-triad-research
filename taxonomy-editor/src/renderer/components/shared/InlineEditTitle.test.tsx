import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditTitle } from './InlineEditTitle';

describe('InlineEditTitle (t/2937)', () => {
  it('renders a <textarea> (not an <input>) so long titles can wrap', () => {
    render(<InlineEditTitle value="A very long title" onChange={vi.fn()} ariaLabel="Label" />);
    const el = screen.getByLabelText('Label');
    expect(el.tagName).toBe('TEXTAREA'); // an <input> is single-line by spec and cannot wrap
    expect((el as HTMLTextAreaElement).value).toBe('A very long title');
  });

  it('fires onChange with the new value on edit', () => {
    const onChange = vi.fn();
    render(<InlineEditTitle value="old" onChange={onChange} ariaLabel="Label" />);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'new title' } });
    expect(onChange).toHaveBeenCalledWith('new title');
  });

  it('Enter commits (blur) and never inserts a newline', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<InlineEditTitle value="title" onChange={onChange} onBlur={onBlur} ariaLabel="Label" />);
    const el = screen.getByLabelText('Label') as HTMLTextAreaElement;
    el.focus();
    const prevented = !fireEvent.keyDown(el, { key: 'Enter' }); // returns false when preventDefault was called
    expect(prevented).toBe(true);   // Enter is intercepted
    expect(onBlur).toHaveBeenCalled(); // committed via blur
    expect(onChange).not.toHaveBeenCalled(); // no newline written
  });

  it('applies the has-error class only when hasError is set', () => {
    const { rerender } = render(<InlineEditTitle value="t" onChange={vi.fn()} ariaLabel="Label" />);
    expect(screen.getByLabelText('Label').className).not.toContain('has-error');
    rerender(<InlineEditTitle value="t" onChange={vi.fn()} hasError ariaLabel="Label" />);
    expect(screen.getByLabelText('Label').className).toContain('has-error');
  });
});
