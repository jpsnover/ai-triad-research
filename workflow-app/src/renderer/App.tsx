import { useEffect } from 'react';
import { usePipelineStore } from './store';
import { Sidebar } from './components/Sidebar';
import { StepDetail } from './components/StepDetail';
import { Header } from './components/Header';
import { PipelineSummary } from './components/PipelineSummary';
import './App.css';

export function App() {
  const { definitions, setDefinitions, setDataRoot, expandedStepId } = usePipelineStore();

  useEffect(() => {
    window.electronAPI.getStepDefinitions().then(defs => {
      setDefinitions(defs);
    });
    window.electronAPI.getDataRoot().then(root => {
      setDataRoot(root);
    });
  }, [setDefinitions, setDataRoot]);

  if (definitions.length === 0) return null;

  return (
    <div className="app-layout">
      <Header />
      <div className="app-body">
        <Sidebar />
        <div className="main-content">
          {expandedStepId ? (
            <StepDetail stepId={expandedStepId} />
          ) : (
            <div className="welcome">
              <h2>AI Triad Workflow Pipeline</h2>
              <p>
                Run the full document ingestion pipeline from import through
                taxonomy updates to git push. Select a step from the sidebar
                to configure and run it, or use "Run All" to execute the
                entire pipeline.
              </p>
            </div>
          )}
        </div>
      </div>
      <PipelineSummary />
    </div>
  );
}
