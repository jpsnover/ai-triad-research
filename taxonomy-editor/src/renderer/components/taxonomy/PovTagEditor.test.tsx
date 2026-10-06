import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PovTagEditor } from './PovTagEditor';

// t/3961: registry injected; the committed registry is empty until t/3956.
const registry = {
  version: 1,
  povs: {
    accelerationist: [
      { id: 'critical', label: 'Critical', soul_doc: 'accelerationist.critical', description: 'd' },
      { id: 'pragmatic', label: 'Pragmatic', soul_doc: 'accelerationist.pragmatic', description: 'd' },
    ],
  },
};

function renderEditor(tags: unknown, opts: { readOnly?: boolean; pov?: string; error?: string } = {}) {
  const onChange = vi.fn();
  const view = render(
    <PovTagEditor pov={opts.pov ?? 'accelerationist'} tags={tags} readOnly={opts.readOnly ?? false} error={opts.error} onChange={onChange} registry={registry} />,
  );
  return { onChange, ...view };
}

describe('PovTagEditor (t/3961)', () => {
  it('renders nothing when the POV has no registry tags and the node has none', () => {
    const { container } = renderEditor(undefined, { pov: 'safetyist' });
    expect(container.firstChild).toBeNull();
  });

  it('still shows an orphan on a POV with no registry tags, so it can be removed', () => {
    const { onChange } = renderEditor(['retired'], { pov: 'safetyist' });
    expect(screen.getByText('retired (not in registry)')).toBeTruthy();
    expect(screen.queryByLabelText('Add POV tag')).toBeNull();
    fireEvent.click(screen.getByLabelText('Remove tag retired'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('offers only registry tags the node does not already carry; no free-text create', () => {
    renderEditor(['critical']);
    const select = screen.getByLabelText('Add POV tag') as HTMLSelectElement;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toEqual(['', 'pragmatic']);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('adding appends the chosen tag', () => {
    const { onChange } = renderEditor(['critical']);
    fireEvent.change(screen.getByLabelText('Add POV tag'), { target: { value: 'pragmatic' } });
    expect(onChange).toHaveBeenCalledWith(['critical', 'pragmatic']);
  });

  it('adding to an untagged node starts a list', () => {
    const { onChange } = renderEditor(undefined);
    expect(screen.getByText('Untagged')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add POV tag'), { target: { value: 'critical' } });
    expect(onChange).toHaveBeenCalledWith(['critical']);
  });

  it('removing one of several keeps the rest; removing the last clears the field', () => {
    const { onChange, unmount } = renderEditor(['critical', 'pragmatic']);
    fireEvent.click(screen.getByLabelText('Remove tag Critical'));
    expect(onChange).toHaveBeenLastCalledWith(['pragmatic']);
    unmount();
    const second = renderEditor(['critical']);
    fireEvent.click(screen.getByLabelText('Remove tag Critical'));
    expect(second.onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('marks a tag the registry lacks as an orphan', () => {
    renderEditor(['critical', 'retired']);
    expect(screen.getByText('retired (not in registry)').className).toContain('pov-tag-chip-orphan');
    expect(screen.getByText('Critical').className).not.toContain('pov-tag-chip-orphan');
  });

  it('read-only shows chips without remove buttons or the picker', () => {
    renderEditor(['critical'], { readOnly: true });
    expect(screen.getByText('Critical')).toBeTruthy();
    expect(screen.queryByLabelText('Remove tag Critical')).toBeNull();
    expect(screen.queryByLabelText('Add POV tag')).toBeNull();
  });

  it('shows the save-gate error for the field', () => {
    renderEditor(['critical'], { error: 'acc-beliefs-001: tag "x" is not registered' });
    expect(screen.getByText('acc-beliefs-001: tag "x" is not registered')).toBeTruthy();
  });
});
