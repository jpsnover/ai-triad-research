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
        </div>
      );
    }

    return this.props.children;
  }
}
