// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { ReactNode } from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  icon?: ReactNode;
  headline: string;
  direction?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, headline, direction, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-headline">{headline}</div>
      {direction && <div className="empty-state-direction">{direction}</div>}
      {action && (
        <button type="button" className="btn btn-primary btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
