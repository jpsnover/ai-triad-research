// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useAnalysisStore, mergeAnalysisIntoSource } from '../store/useAnalysisStore';
import type { AnalysisProgressEvent, AnalysisResult } from '../types/analysis';
import FilterBar from './FilterBar';
import SearchBar from './SearchBar';
import HighlightedText from './HighlightedText';
import PdfViewer from './PdfViewer';
import AnalysisProgress from './AnalysisProgress';

export default function SourceViewer() {
  const notebooks = useAppStore(s => s.notebooks);
  const activeNotebookId = useAppStore(s => s.activeNotebookId);
  const selectedSourceId = useAppStore(s => s.selectedSourceId);
  const updateSource = useAppStore(s => s.updateSource);
  const analyses = useAnalysisStore(s => s.analyses);
  const startAnalysis = useAnalysisStore(s => s.startAnalysis);
  const updateProgress = useAnalysisStore(s => s.updateProgress);
  const cancelStoreAnalysis = useAnalysisStore(s => s.cancelAnalysis);

  const notebook = notebooks.find(n => n.id === activeNotebookId) ?? notebooks[0];
  const source = selectedSourceId
    ? notebook.sources.find(s => s.id === selectedSourceId) ?? null
    : null;

  const analysisState = selectedSourceId ? analyses[selectedSourceId] : null;
  const isAnalyzing = analysisState && !['idle', 'complete', 'error'].includes(analysisState.status);

  const handleAnalyze = useCallback(async () => {
    if (!source) return;
    startAnalysis(source.id);
    updateSource(source.id, { status: 'analyzing' });

    // Listen for progress events
    let cleanup: (() => void) | undefined;
    if (window.electronAPI?.onAnalysisProgress) {
      cleanup = window.electronAPI.onAnalysisProgress((event: unknown) => {
        updateProgress(event as AnalysisProgressEvent);
      });
    }

    try {
      const result = await window.electronAPI.runAnalysis(source.id, source.snapshotText);
      const analysisResult = result as AnalysisResult;
      const updated = mergeAnalysisIntoSource(source, analysisResult);
      updateSource(source.id, {
        status: 'analyzed',
        points: updated.points,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      if (message !== 'Analysis cancelled') {
        updateSource(source.id, { status: 'error' });
      } else {
        updateSource(source.id, { status: 'pending' });
      }
    } finally {
      cleanup?.();
    }
  }, [source, startAnalysis, updateProgress, updateSource]);

  const handleCancel = useCallback(() => {
    if (!source) return;
    window.electronAPI.cancelAnalysis(source.id);
    cancelStoreAnalysis(source.id);
    updateSource(source.id, { status: 'pending' });
  }, [source, cancelStoreAnalysis, updateSource]);

  if (!source) {
    return (
      <>
        <div className="pane-header">
          <h2>Document</h2>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">&#128065;</div>
          <div className="empty-state-text">Select a source to view</div>
        </div>
      </>
    );
  }

  if (isAnalyzing) {
    return (
      <>
        <div className="pane-header">
          <h2>{source.title}</h2>
        </div>
        <AnalysisProgress sourceId={source.id} onCancel={handleCancel} />
      </>
    );
  }

  if (source.status === 'pending') {
    return (
      <>
        <div className="pane-header">
          <h2>{source.title}</h2>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">&#9203;</div>
          {source.snapshotText ? (
            <>
              <div className="empty-state-text">This source has not been analyzed yet</div>
              <button className="analyze-btn" onClick={handleAnalyze}>
                Analyze with Gemini
              </button>
            </>
          ) : (
            <div className="empty-state-text">
              No text content loaded. Re-add this source from a .md or .pdf file.
            </div>
          )}
        </div>
      </>
    );
  }

  if (source.status === 'error') {
    return (
      <>
        <div className="pane-header">
          <h2>{source.title}</h2>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">!</div>
          <div className="empty-state-text">Analysis failed</div>
          <button className="analyze-btn" onClick={handleAnalyze}>
            Retry Analysis
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pane-header">
        <h2>Document</h2>
        {source.status === 'analyzed' && (
          <button className="analyze-btn analyze-btn-sm" onClick={handleAnalyze} title="Re-analyze">
            Re-analyze
          </button>
        )}
      </div>
      <FilterBar />
      <SearchBar text={source.snapshotText} />
      <div className="pane-body">
        {source.sourceType === 'pdf' ? (
          <PdfViewer source={source} />
        ) : (
          <HighlightedText source={source} />
        )}
      </div>
    </>
  );
}
