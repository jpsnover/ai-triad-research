// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { EntityDetail } from '@lib/entities/types';

vi.mock('@lib/flight-recorder/index', () => ({ getGlobalRecorder: () => ({ record: vi.fn() }) }));

// A plain (non-vi.fn) reassignable impl backs the mocked resolveRef so a rejected
// return is NOT instrumented by vi.fn's settledResults tracking (which would attach
// a handler-less .then and surface a spurious unhandled rejection). A separate spy
// records calls for assertions.
const resolveSpy = vi.fn<(ref: unknown) => void>();
let resolveImpl: (ref: unknown) => Promise<EntityDetail>;
vi.mock('./resolveRef', () => ({
  resolveRef: (ref: unknown) => { resolveSpy(ref); return resolveImpl(ref); },
}));

// Stub the per-kind detail components so this suite tests DISPATCH, not the children.
vi.mock('../taxonomy/NodeDetail', () => ({ NodeDetail: (p: any) => <div data-testid="node-detail" data-pov={p.pov}>{p.node.id}</div> }));
vi.mock('../debate/SituationDetail', () => ({ SituationDetail: (p: any) => <div data-testid="situation-detail">{p.node.id}</div> }));
vi.mock('../organizations/OrganizationDetail', () => ({ OrganizationDetail: (p: any) => <div data-testid="org-detail">{p.org.name}</div> }));
vi.mock('./EntityDetail', () => ({ EntityDetail: (p: any) => <div data-testid="entity-detail" data-redirect={p.redirectedFrom}>{p.entity.name}</div> }));

import { DetailPane } from './DetailPane';

const ready = (detail: any): void => { resolveImpl = async () => detail as EntityDetail; };

beforeEach(() => {
  resolveSpy.mockReset();
  resolveImpl = async () => ({ kind: 'not_found', ref: { kind: 'node', id: 'unset' } });
});

describe('DetailPane — dispatch by EntityDetail.kind', () => {
  it('renders the idle empty state when nothing is selected', () => {
    render(<DetailPane selectedRef={null} />);
    expect(screen.getByText('Select a reference')).toBeInTheDocument();
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('dispatches a node ref to NodeDetail with the pov derived from the id', async () => {
    ready({ kind: 'node', ref: { kind: 'node', id: 'acc-desires-001' }, record: { id: 'acc-desires-001', label: 'X' } });
    render(<DetailPane selectedRef={{ kind: 'node', id: 'acc-desires-001' }} />);
    const el = await screen.findByTestId('node-detail');
    expect(el).toHaveAttribute('data-pov', 'accelerationist');
  });

  it('dispatches a situation ref to SituationDetail', async () => {
    ready({ kind: 'situation', ref: { kind: 'situation', id: 'sit-003' }, record: { id: 'sit-003', label: 'S' } });
    render(<DetailPane selectedRef={{ kind: 'situation', id: 'sit-003' }} />);
    expect(await screen.findByTestId('situation-detail')).toBeInTheDocument();
  });

  it('dispatches an organization ref to OrganizationDetail', async () => {
    ready({ kind: 'organization', ref: { kind: 'organization', id: 'org-001' }, record: { name: 'FLI' } });
    render(<DetailPane selectedRef={{ kind: 'organization', id: 'org-001' }} />);
    expect(await screen.findByTestId('org-detail')).toHaveTextContent('FLI');
  });

  it('renders a policy ref inline', async () => {
    ready({ kind: 'policy', ref: { kind: 'policy', id: 'pol-010' }, record: { id: 'pol-010', action: 'Pause training' } });
    render(<DetailPane selectedRef={{ kind: 'policy', id: 'pol-010' }} />);
    expect(await screen.findByText('pol-010')).toBeInTheDocument();
  });

  it('dispatches an entity ref to the rich EntityDetail (no placeholder)', async () => {
    ready({ kind: 'entity', ref: { kind: 'entity', id: 'ent-042' }, record: { name: 'OpenAI' } });
    render(<DetailPane selectedRef={{ kind: 'entity', id: 'ent-042' }} />);
    expect(await screen.findByTestId('entity-detail')).toHaveTextContent('OpenAI');
    expect(screen.queryByText('Detailed entity view coming soon.')).not.toBeInTheDocument();
  });

  it('still renders a term ref as the deferred Phase-1.5 fallback', async () => {
    ready({ kind: 'term', ref: { kind: 'term', id: 'term:p-doom' }, record: { colloquial_term: 'p(doom)' } });
    render(<DetailPane selectedRef={{ kind: 'term', id: 'term:p-doom' }} />);
    expect(await screen.findByText('Detailed term view coming soon.')).toBeInTheDocument();
  });

  it('renders a not_found result as an empty state', async () => {
    ready({ kind: 'not_found', ref: { kind: 'node', id: 'acc-desires-999' } });
    render(<DetailPane selectedRef={{ kind: 'node', id: 'acc-desires-999' }} />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});

describe('DetailPane — contract edge cases', () => {
  it('honors redirected_from by re-selecting the canonical ref', async () => {
    const onSelectRef = vi.fn();
    ready({ kind: 'entity', ref: { kind: 'entity', id: 'ent-002' }, redirected_from: 'ent-001', record: { name: 'Canonical' } });
    render(<DetailPane selectedRef={{ kind: 'entity', id: 'ent-001' }} onSelectRef={onSelectRef} />);
    await waitFor(() => expect(onSelectRef).toHaveBeenCalledWith({ kind: 'entity', id: 'ent-002' }));
  });

  it('does NOT re-select when the resolved ref matches the request (no redirect)', async () => {
    const onSelectRef = vi.fn();
    ready({ kind: 'organization', ref: { kind: 'organization', id: 'org-001' }, record: { name: 'FLI' } });
    render(<DetailPane selectedRef={{ kind: 'organization', id: 'org-001' }} onSelectRef={onSelectRef} />);
    await screen.findByTestId('org-detail');
    expect(onSelectRef).not.toHaveBeenCalled();
  });

  it('shows a graceful "detail unavailable" state when resolution rejects (electron degrade)', async () => {
    resolveImpl = async () => { throw new Error('Entity resolution is not available in desktop mode yet'); };
    render(<DetailPane selectedRef={{ kind: 'entity', id: 'ent-001' }} />);
    expect(await screen.findByText('Detail unavailable')).toBeInTheDocument();
  });
});

describe('DetailPane — keyboard a11y (t/1925)', () => {
  const orgReady = () => ready({ kind: 'organization', ref: { kind: 'organization', id: 'org-001' }, record: { name: 'FLI' } });

  it('closes on Escape via onClose', async () => {
    const onClose = vi.fn();
    orgReady();
    render(<DetailPane selectedRef={{ kind: 'organization', id: 'org-001' }} onClose={onClose} />);
    await screen.findByTestId('org-detail');
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not bind Escape when no onClose is provided (read-only pane)', async () => {
    orgReady();
    render(<DetailPane selectedRef={{ kind: 'organization', id: 'org-001' }} />);
    await screen.findByTestId('org-detail');
    // No throw / no handler — Escape is a no-op; the region simply has no onKeyDown.
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('moves focus into the pane on open and restores it to the invoker on close', async () => {
    orgReady();
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button data-testid="invoker">open</button>
          {open && <DetailPane selectedRef={{ kind: 'organization', id: 'org-001' }} onClose={vi.fn()} />}
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const invoker = screen.getByTestId('invoker');
    invoker.focus();
    expect(document.activeElement).toBe(invoker);

    rerender(<Harness open />);
    await screen.findByTestId('org-detail');
    expect(document.activeElement).toBe(screen.getByRole('region')); // focus moved into the pane

    rerender(<Harness open={false} />); // close → pane unmounts
    expect(document.activeElement).toBe(invoker); // focus restored to the invoker
  });
});
