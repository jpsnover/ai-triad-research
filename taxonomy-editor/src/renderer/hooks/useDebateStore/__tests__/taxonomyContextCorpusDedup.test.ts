// t/3165 — regression test for the per-debate corpus-embed dedup (defense-in-depth blast-radius
// mitigation for the embedding-saturation incident; the ROOT fix is prod embeddings.json coverage,
// DevOps-owned). Proves the shared static corpus (situations) is embedded ONCE per debate, not
// once per speaker, and that per-speaker pov tagging + per-debate scoping are preserved.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  computeEmbeddings: vi.fn(),
  activeDebateId: 'd0' as string | null,
}));

vi.mock('@bridge', () => ({
  api: {
    computeEmbeddings: h.computeEmbeddings,
    loadSyntheticEmbeddings: async () => null, // no synthetic merge in the test
  },
}));
vi.mock('../store', () => ({
  useDebateStore: { getState: () => ({ activeDebate: h.activeDebateId ? { id: h.activeDebateId } : null }) },
}));
vi.mock('../../useTaxonomyStore', () => ({ useTaxonomyStore: { getState: () => ({}) } }));

import { buildNodeEmbeddingMap } from '../shared/taxonomyContext';

const node = (id: string) => ({ id, label: id, description: 'd' }) as never;

beforeEach(() => {
  h.computeEmbeddings.mockReset();
  h.computeEmbeddings.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => [1, 2, 3]) }));
});

describe('buildNodeEmbeddingMap — per-debate corpus dedup (t/3165)', () => {
  it('embeds the shared situation corpus ONCE across speakers, not per-speaker', async () => {
    h.activeDebateId = 'd-shared';
    const situations = [node('sit-1'), node('sit-2'), node('sit-3')];
    // Speaker 1 (acc): its POV nodes + all situations
    await buildNodeEmbeddingMap('accelerationist', [node('acc-1'), node('acc-2')], situations);
    // Speaker 2 (saf): its POV nodes + the SAME situations
    await buildNodeEmbeddingMap('safetyist', [node('saf-1')], situations);

    expect(h.computeEmbeddings).toHaveBeenCalledTimes(2);
    // 1st call embeds acc-1/acc-2 + the 3 situations; 2nd embeds ONLY saf-1 (situations memoized)
    expect(h.computeEmbeddings.mock.calls[0][1]).toEqual(['acc-1', 'acc-2', 'sit-1', 'sit-2', 'sit-3']);
    expect(h.computeEmbeddings.mock.calls[1][1]).toEqual(['saf-1']);
  });

  it('resolves memoized nodes with the CURRENT speaker pov tag (behaviour-equivalent)', async () => {
    h.activeDebateId = 'd-tag';
    const situations = [node('sit-9')];
    await buildNodeEmbeddingMap('accelerationist', [node('acc-9')], situations);
    const { nodeEmbeddings } = await buildNodeEmbeddingMap('safetyist', [node('saf-9')], situations);
    // sit-9 came from the memo but is tagged with the second speaker's pov, exactly as before
    expect(nodeEmbeddings['sit-9']).toEqual({ pov: 'safetyist', vector: [1, 2, 3] });
    expect(nodeEmbeddings['saf-9']).toEqual({ pov: 'safetyist', vector: [1, 2, 3] });
  });

  it('re-embeds when the debate changes (memo is scoped per debate, not global)', async () => {
    const situations = [node('sit-x')];
    h.activeDebateId = 'd-A';
    await buildNodeEmbeddingMap('accelerationist', [], situations);
    h.activeDebateId = 'd-B'; // new debate → memo cleared, so sit-x re-embeds
    await buildNodeEmbeddingMap('accelerationist', [], situations);
    expect(h.computeEmbeddings).toHaveBeenCalledTimes(2);
    expect(h.computeEmbeddings.mock.calls[1][1]).toEqual(['sit-x']);
  });
});
