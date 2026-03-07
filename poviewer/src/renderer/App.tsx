// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { useEffect, useState } from 'react';
import { useResizablePanes } from './hooks/useResizablePanes';
import { useAppStore } from './store/useAppStore';
import { useAnalysisStore } from './store/useAnalysisStore';
import ResizeHandle from './components/ResizeHandle';
import SourcesPane from './components/SourcesPane';
import SourceViewer from './components/SourceViewer';
import PovPanel from './components/PovPanel';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/Toast';
import OnboardingWizard from './components/OnboardingWizard';

function useThemeEffect() {
  const theme = useAppStore(s => s.theme);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => { root.dataset.theme = mq.matches ? 'dark' : 'light'; };
      apply();
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }

    root.dataset.theme = theme;
  }, [theme]);
}

function useOnboardingCheck() {
  const hasApiKey = useAnalysisStore(s => s.hasApiKey);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Check if first run (no API key and never dismissed onboarding)
    const dismissed = localStorage.getItem('poviewer-onboarding-dismissed');
    if (dismissed) {
      setChecked(true);
      return;
    }

    if (window.electronAPI?.getApiKey) {
      window.electronAPI.getApiKey().then(key => {
        if (!key) {
          setShowOnboarding(true);
        }
        setChecked(true);
      });
    } else {
      setChecked(true);
    }
  }, []);

  const dismissOnboarding = () => {
    localStorage.setItem('poviewer-onboarding-dismissed', 'true');
    setShowOnboarding(false);
  };

  return { showOnboarding, checked, dismissOnboarding };
}

export default function App() {
  useThemeEffect();
  const { widths, containerRef, onMouseDown, draggingRef } = useResizablePanes();
  const { showOnboarding, checked, dismissOnboarding } = useOnboardingCheck();
  const pipelineLoaded = useAppStore(s => s.pipelineLoaded);
  const loadFromPipeline = useAppStore(s => s.loadFromPipeline);

  useEffect(() => {
    if (!pipelineLoaded) {
      loadFromPipeline();
    }
  }, [pipelineLoaded, loadFromPipeline]);

  useEffect(() => {
    if (!window.electronAPI?.onTaxonomyChanged) return;
    const cleanup = window.electronAPI.onTaxonomyChanged((event) => {
      console.log(`[POViewer] Taxonomy changed: ${event.pov}, reloading...`);
      loadFromPipeline();
    });
    return cleanup;
  }, [loadFromPipeline]);

  if (!checked || !pipelineLoaded) return null;

  if (showOnboarding) {
    return (
      <>
        <OnboardingWizard onComplete={dismissOnboarding} />
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      <div className="app-container" ref={containerRef}>
        <div className="pane" style={{ width: `${widths[0]}%` }}>
          <ErrorBoundary fallbackLabel="Sources">
            <SourcesPane />
          </ErrorBoundary>
        </div>
        <ResizeHandle index={0} onMouseDown={onMouseDown} isActive={draggingRef.current === 0} />
        <div className="pane" style={{ width: `${widths[1]}%` }}>
          <ErrorBoundary fallbackLabel="Document">
            <SourceViewer />
          </ErrorBoundary>
        </div>
        <ResizeHandle index={1} onMouseDown={onMouseDown} isActive={draggingRef.current === 1} />
        <div className="pane" style={{ width: `${widths[2]}%` }}>
          <ErrorBoundary fallbackLabel="Analysis">
            <PovPanel />
          </ErrorBoundary>
        </div>
      </div>
      <ToastContainer />
    </>
  );
}
