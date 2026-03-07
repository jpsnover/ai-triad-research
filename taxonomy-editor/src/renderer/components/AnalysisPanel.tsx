// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

interface AnalysisPanelProps {
  width?: number;
}

const STEPS = [
  { step: 1, label: 'Preparing elements' },
  { step: 2, label: 'Building audit prompt' },
  { step: 3, label: 'Sending to AI' },
  { step: 4, label: 'Processing response' },
];

export function AnalysisPanel({ width }: AnalysisPanelProps) {
  const {
    analysisResult,
    analysisLoading,
    analysisError,
    analysisStep,
    analysisRetry,
    analysisCached,
    analysisElementA,
    analysisElementB,
    clearAnalysis,
    runAnalyzeDistinction,
    geminiModel,
  } = useTaxonomyStore();

  if (!analysisResult && !analysisLoading && !analysisError) return null;

  const handleRefresh = () => {
    if (analysisElementA && analysisElementB) {
      runAnalyzeDistinction(analysisElementA, analysisElementB, true);
    }
  };

  return (
    <div className="analysis-panel" style={width ? { width, minWidth: 320 } : undefined}>
      <div className="analysis-panel-header">
        <div className="analysis-panel-title">
          Analyze Distinction
          {analysisCached && <span className="analysis-cached-badge">cached</span>}
        </div>
        <div className="analysis-panel-actions">
          {analysisResult && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleRefresh}
              title={`Re-run with ${geminiModel}`}
            >
              Refresh
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={clearAnalysis}>
            Close
          </button>
        </div>
      </div>

      {analysisElementA && analysisElementB && (
        <div className="analysis-elements">
          <div className="analysis-element">
            <div className="analysis-element-tag">Element A <span className="analysis-element-category">{analysisElementA.category}</span></div>
            <div className="analysis-element-label">{analysisElementA.label}</div>
          </div>
          <div className="analysis-vs">vs</div>
          <div className="analysis-element">
            <div className="analysis-element-tag">Element B <span className="analysis-element-category">{analysisElementB.category}</span></div>
            <div className="analysis-element-label">{analysisElementB.label}</div>
          </div>
        </div>
      )}

      {analysisLoading && analysisStep > 0 && (
        <div className="analysis-steps">
          {STEPS.map(({ step, label }) => {
            const displayLabel = step === 3 ? `Sending to ${geminiModel}` : label;
            let status: 'pending' | 'active' | 'done' = 'pending';
            if (analysisStep > step) status = 'done';
            else if (analysisStep === step) status = 'active';

            return (
              <div key={step}>
                <div className={`analysis-step analysis-step-${status}`}>
                  <span className="analysis-step-indicator">
                    {status === 'done' && '\u2713'}
                    {status === 'active' && <span className="search-spinner" />}
                    {status === 'pending' && <span className="analysis-step-dot" />}
                  </span>
                  <span className="analysis-step-label">{displayLabel}</span>
                </div>
                {step === 3 && status === 'active' && analysisRetry && (
                  <div className="analysis-retry-info">
                    <div className="analysis-retry-headline">
                      {analysisRetry.limitType !== 'unknown'
                        ? `${analysisRetry.limitType} limit hit`
                        : 'Rate limited'} — retry {analysisRetry.attempt}/{analysisRetry.maxRetries}, waiting {analysisRetry.backoffSeconds}s
                    </div>
                    <div className="analysis-retry-detail">
                      {analysisRetry.limitMessage}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {analysisError && (
        <div className="search-error">{analysisError}</div>
      )}

      {analysisResult && (
        <div className="analysis-result markdown-body">
          <Markdown remarkPlugins={[remarkGfm]}>{analysisResult}</Markdown>
        </div>
      )}
    </div>
  );
}
