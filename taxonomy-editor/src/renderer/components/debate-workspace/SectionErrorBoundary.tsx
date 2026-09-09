// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// t/3419: the top-level react-error-boundary (lib/electron-shared) is correctly
// wired for a genuinely fatal crash, but using it for a single render-field throw
// (t/3418) unmounts the entire debate workspace — the wrong blast radius for a
// contained, recoverable render failure in one panel. This boundary catches at
// section granularity and degrades to an inline fallback instead, logging at
// `error` (not `fatal`) so the caught failure is diagnosable without triggering
// the top-level crash/dump flow.

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { getGlobalRecorder } from '@lib/flight-recorder/index';

interface Props {
  children: ReactNode;
  /** Human-readable section label — surfaced in the fallback UI and the FR record. */
  section: string;
}

interface State {
  hasError: boolean;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'debate-workspace',
      level: 'error',
      message: `Section render failed: ${this.props.section}`,
      error: { name: error.name, message: error.message, stack: error.stack },
      data: { section: this.props.section, component_stack: info.componentStack?.slice(0, 1000) },
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="taxrefs-section-error" role="alert">
          Couldn&rsquo;t render {this.props.section}.
        </div>
      );
    }
    return this.props.children;
  }
}
