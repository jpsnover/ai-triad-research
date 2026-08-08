// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// beginDebate lineage pipeline-status diagnostics (t/2271). A topic-specific lineage
// frame is only computed during topic critique, so URL/document/situations debates
// legitimately have no frame — their pipeline-status must be `info`, not `warn`.
// Only a topic debate that *should* have a frame but doesn't warrants a warn.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

import { mockApi, makeSession } from './storeTestHarness';
import { useDebateStore } from '../../useDebateStore';

function pipelineStatusRecords() {
  return mockRecord.mock.calls
    .map(c => c[0])
    .filter((e: { type?: string }) => e?.type === 'lineage.pipeline-status');
}

describe('beginDebate: lineage.pipeline-status level (t/2271)', () => {
  beforeEach(() => {
    mockRecord.mockClear();
    mockApi.loadDictionary.mockResolvedValue({ standardized: [], colloquial: [], lintViolations: [] });
  });

  it('warns for a topic debate with no computed lineage frame', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({ phase: 'clarification', source_type: 'topic' }) as never,
    });

    await useDebateStore.getState().beginDebate();

    const [status] = pipelineStatusRecords();
    expect(status).toBeDefined();
    expect(status.level).toBe('warn');
    expect(status.data.lineage_frame_expected).toBe(true);
    expect(status.data.boost_configured).toBe(false);
  });

  it('reports info (not warn) for a URL debate — no frame is expected', async () => {
    useDebateStore.setState({
      activeDebate: makeSession({
        phase: 'clarification',
        source_type: 'url',
        source_ref: 'https://example.com/article',
        source_content: 'Article text',
      }) as never,
    });
    // Halt after the pipeline-status record so the document-analysis path doesn't run.
    mockApi.generateText.mockResolvedValue({ text: '{}' });

    await useDebateStore.getState().beginDebate();

    const [status] = pipelineStatusRecords();
    expect(status).toBeDefined();
    expect(status.level).toBe('info');
    expect(status.data.lineage_frame_expected).toBe(false);
    expect(status.data.source_type).toBe('url');
  });
});
