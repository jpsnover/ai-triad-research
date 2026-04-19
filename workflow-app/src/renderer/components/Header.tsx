import { usePipelineStore } from '../store';
import { useRunPipeline } from './useRunPipeline';

export function Header() {
  const { pipelineRunning, resetAll, dataRoot } = usePipelineStore();
  const { runAll, cancel } = useRunPipeline();

  return (
    <div className="app-header">
      <h1>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M10 2L18 6V14L10 18L2 14V6L10 2Z" stroke="#58a6ff" strokeWidth="1.5" fill="none" />
          <circle cx="10" cy="10" r="3" fill="#58a6ff" />
        </svg>
        AI Triad Workflow
        {dataRoot && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
            {dataRoot.split(/[\\/]/).slice(-1)[0]}
          </span>
        )}
      </h1>
      <div className="header-actions">
        {pipelineRunning ? (
          <button className="btn btn-danger" onClick={cancel}>
            Cancel Pipeline
          </button>
        ) : (
          <>
            <button className="btn" onClick={resetAll}>
              Reset All
            </button>
            <button className="btn btn-primary" onClick={runAll}>
              Run All Steps
            </button>
          </>
        )}
      </div>
    </div>
  );
}
