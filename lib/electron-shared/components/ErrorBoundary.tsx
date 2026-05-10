// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
  /** Optional build identifier shown in error UI (e.g. BUILD_FINGERPRINT) */
  buildInfo?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.fallbackLabel ? ` - ${this.props.fallbackLabel}` : ''}]`, error, info);
    // Stash crash details on globalThis so Dump Log can include them even if the
    // flight recorder hook wasn't initialized before the crash.
    (globalThis as unknown as { __lastErrorBoundaryCrash?: { error: Error; componentStack?: string; timestamp: number } }).__lastErrorBoundaryCrash = {
      error, componentStack: info.componentStack ?? undefined, timestamp: Date.now(),
    };
    // Flight recorder dump — uses global hook to avoid hard dependency from shared lib.
    // The taxonomy-editor sets this in flightRecorderInit.ts.
    const hook = (globalThis as unknown as { __onErrorBoundaryCatch?: (err: Error, stack?: string) => void }).__onErrorBoundaryCatch;
    if (hook) hook(error, info.componentStack ?? undefined);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">!</div>
          <div className="error-boundary-text">
            Something went wrong{this.props.fallbackLabel ? ` in ${this.props.fallbackLabel}` : ''}
          </div>
          {this.props.buildInfo && (
            <div className="error-boundary-build">{this.props.buildInfo}</div>
          )}
          <div className="error-boundary-detail">
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button className="error-boundary-retry" onClick={this.handleRetry}>
            Try Again
          </button>
          <button className="error-boundary-retry" onClick={(e) => {
            const btn = e.target as HTMLButtonElement;
            const crash = (globalThis as unknown as { __lastErrorBoundaryCrash?: { error: Error; componentStack?: string; timestamp: number } }).__lastErrorBoundaryCrash;
            if (crash) {
              console.error('[ErrorBoundary Dump]', crash.error.message, '\nStack:', crash.error.stack, '\nComponent:', crash.componentStack);
            }
            const hook = (globalThis as unknown as { __triggerManualDump?: () => void }).__triggerManualDump;
            if (hook) {
              hook();
              btn.textContent = 'Dumped!';
            } else if (crash) {
              btn.textContent = 'See console (F12)';
            } else {
              btn.textContent = 'No recorder';
            }
          }} style={{ marginLeft: 8 }}>
            Dump Log
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
