import { useTaxonomyStore } from '../hooks/useTaxonomyStore';

interface AnalysisPanelProps {
  width?: number;
}

const STEPS = [
  { step: 1, label: 'Preparing elements' },
  { step: 2, label: 'Building audit prompt' },
  { step: 3, label: 'Sending to Gemini AI' },
  { step: 4, label: 'Processing response' },
  { step: 5, label: 'Complete' },
];

export function AnalysisPanel({ width }: AnalysisPanelProps) {
  const {
    analysisResult,
    analysisLoading,
    analysisError,
    analysisStep,
    analysisElementA,
    analysisElementB,
    clearAnalysis,
  } = useTaxonomyStore();

  if (!analysisResult && !analysisLoading && !analysisError) return null;

  return (
    <div className="analysis-panel" style={width ? { width, minWidth: 320 } : undefined}>
      <div className="analysis-panel-header">
        <div className="analysis-panel-title">Analyze Distinction</div>
        <button className="btn btn-ghost btn-sm" onClick={clearAnalysis}>
          Close
        </button>
      </div>

      {analysisElementA && analysisElementB && (
        <div className="analysis-elements">
          <div className="analysis-element">
            <div className="analysis-element-tag">Element A</div>
            <div className="analysis-element-label">{analysisElementA.label}</div>
          </div>
          <div className="analysis-vs">vs</div>
          <div className="analysis-element">
            <div className="analysis-element-tag">Element B</div>
            <div className="analysis-element-label">{analysisElementB.label}</div>
          </div>
        </div>
      )}

      {(analysisLoading || analysisStep > 0) && (
        <div className="analysis-steps">
          {STEPS.map(({ step, label }) => {
            let status: 'pending' | 'active' | 'done' = 'pending';
            if (analysisStep > step) status = 'done';
            else if (analysisStep === step) status = analysisLoading ? 'active' : 'done';

            return (
              <div key={step} className={`analysis-step analysis-step-${status}`}>
                <span className="analysis-step-indicator">
                  {status === 'done' && '\u2713'}
                  {status === 'active' && <span className="search-spinner" />}
                  {status === 'pending' && <span className="analysis-step-dot" />}
                </span>
                <span className="analysis-step-label">{label}</span>
              </div>
            );
          })}
        </div>
      )}

      {analysisError && (
        <div className="search-error">{analysisError}</div>
      )}

      {analysisResult && (
        <div className="analysis-result">
          {analysisResult.split('\n').map((line, i) => {
            if (/^\*?\*?(The Verdict|The Delta|Logical Gap|Blind Spot Check):?\*?\*?/i.test(line.trim())) {
              return <p key={i} className="analysis-heading">{line}</p>;
            }
            if (line.trim() === '') {
              return <br key={i} />;
            }
            return <p key={i}>{line}</p>;
          })}
        </div>
      )}
    </div>
  );
}
