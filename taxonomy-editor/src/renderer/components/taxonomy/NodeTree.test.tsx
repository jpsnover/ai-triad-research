import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeTree, getOrderedNodeIds, type ClusterGroup } from './NodeTree';
import type { PovNode } from '../../types/taxonomy';

vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: vi.fn() }),
}));

vi.mock('../conflict/edit-conflicts', () => ({
  EditConflictBadge: () => null,
}));

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

Element.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.focus = vi.fn();

function makeNode(overrides: Partial<PovNode> & { id: string; category: string }): PovNode {
  return {
    label: overrides.id,
    description: '',
    children: [],
    parent_id: null,
    parent_relationship: null,
    ...overrides,
  } as PovNode;
}

const NODES: PovNode[] = [
  makeNode({ id: 'acc-B-001', category: 'Beliefs', label: 'Open dev is safe', confidence: 0.9 }),
  makeNode({ id: 'acc-B-002', category: 'Beliefs', label: 'Markets self-correct', confidence: 0.6 }),
  makeNode({ id: 'acc-D-001', category: 'Desires', label: 'Maximize progress', priority: 5 }),
  makeNode({ id: 'acc-D-002', category: 'Desires', label: 'Open access', priority: 3 }),
  makeNode({ id: 'acc-I-001', category: 'Intentions', label: 'Fund research' }),
  makeNode({ id: 'acc-I-002', category: 'Intentions', label: 'Publish papers' }),
];

describe('getOrderedNodeIds', () => {
  it('returns IDs grouped by category order (Desires, Intentions, Beliefs)', () => {
    const ids = getOrderedNodeIds(NODES, 'id');
    const desireIdx = ids.indexOf('acc-D-001');
    const intentionIdx = ids.indexOf('acc-I-001');
    const beliefIdx = ids.indexOf('acc-B-001');
    expect(desireIdx).toBeLessThan(intentionIdx);
    expect(intentionIdx).toBeLessThan(beliefIdx);
  });

  it('sorts alphabetically by label within categories when sortMode is label', () => {
    const ids = getOrderedNodeIds(NODES, 'label');
    const desires = ids.filter(id => id.includes('-D-'));
    expect(desires[0]).toBe('acc-D-001');
    expect(desires[1]).toBe('acc-D-002');
  });

  it('sorts by priority descending for Desires in priority mode', () => {
    const ids = getOrderedNodeIds(NODES, 'priority');
    const desires = ids.filter(id => id.includes('-D-'));
    expect(desires[0]).toBe('acc-D-001');
    expect(desires[1]).toBe('acc-D-002');
  });

  it('sorts by confidence descending for Beliefs in priority mode', () => {
    const ids = getOrderedNodeIds(NODES, 'priority');
    const beliefs = ids.filter(id => id.includes('-B-'));
    expect(beliefs[0]).toBe('acc-B-001');
    expect(beliefs[1]).toBe('acc-B-002');
  });

  it('returns cluster order when clusters are provided in similarity mode', () => {
    const clusters: ClusterGroup[] = [
      { label: 'Cluster A', nodeIds: ['acc-I-002', 'acc-B-001'] },
      { label: 'Cluster B', nodeIds: ['acc-D-001'] },
    ];
    const ids = getOrderedNodeIds(NODES, 'similarity', null, clusters);
    expect(ids).toEqual(['acc-I-002', 'acc-B-001', 'acc-D-001']);
  });
});

describe('NodeTree', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mockLocalStorage.setItem('taxonomy-editor-collapsed-version', '2');
    mockLocalStorage.setItem('taxonomy-editor-collapsed-categories', '[]');
  });

  it('renders category headers with counts', () => {
    render(<NodeTree nodes={NODES} selectedNodeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Desires/)).toBeDefined();
    expect(screen.getByText(/Intentions/)).toBeDefined();
    expect(screen.getByText(/Beliefs/)).toBeDefined();
  });

  it('calls onSelect when a node is clicked', () => {
    const onSelect = vi.fn();
    render(<NodeTree nodes={NODES} selectedNodeId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Open dev is safe').closest('.node-item')!);
    expect(onSelect).toHaveBeenCalledWith('acc-B-001');
  });

  it('applies selected class to the active node', () => {
    render(<NodeTree nodes={NODES} selectedNodeId="acc-B-001" onSelect={vi.fn()} />);
    const nodeEl = screen.getByText('Open dev is safe').closest('.node-item');
    expect(nodeEl?.className).toContain('selected');
  });

  it('shows cluster loading state when sortMode is similarity and loading', () => {
    render(
      <NodeTree
        nodes={NODES}
        selectedNodeId={null}
        onSelect={vi.fn()}
        sortMode="similarity"
        clusterLoading={true}
      />,
    );
    expect(screen.getByText('Clustering nodes...')).toBeDefined();
  });

  it('renders cluster groups when clusters are provided', () => {
    const clusters: ClusterGroup[] = [
      { label: 'Safety beliefs', nodeIds: ['acc-B-001', 'acc-B-002'] },
    ];
    render(
      <NodeTree
        nodes={NODES}
        selectedNodeId={null}
        onSelect={vi.fn()}
        sortMode="similarity"
        clusters={clusters}
      />,
    );
    expect(screen.getByText(/Safety beliefs/)).toBeDefined();
  });

  it('displays node IDs alongside labels', () => {
    render(<NodeTree nodes={NODES} selectedNodeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('acc-B-001')).toBeDefined();
    expect(screen.getByText('acc-D-001')).toBeDefined();
  });
});
