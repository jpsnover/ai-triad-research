// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { create } from 'zustand';
import {
  subscribeResilience,
  getResilienceState,
  type ResilienceStatus,
  type EndpointCategory,
  type CircuitState,
  type ThrottleState,
} from '../bridge/resilience';

export interface ResilienceAlert {
  id: number;
  kind: 'degraded' | 'server-down' | 'reconnecting';
  category: EndpointCategory;
  message: string;
}

export interface RecoveryToast {
  id: number;
  message: string;
}

const CATEGORY_LABELS: Record<EndpointCategory, string> = {
  read: 'Data',
  mutation: 'Save',
  ai: 'AI service',
  admin: 'Admin',
  telemetry: 'Telemetry',
};

interface ResilienceUIStore {
  alerts: ResilienceAlert[];
  toasts: RecoveryToast[];
  dismissToast: (id: number) => void;
  _prevCircuits: Record<EndpointCategory, CircuitState>;
  _prevThrottles: Record<EndpointCategory, ThrottleState>;
  _handleUpdate: (status: ResilienceStatus) => void;
}

let toastCounter = 0;

function buildAlerts(status: ResilienceStatus): ResilienceAlert[] {
  const alerts: ResilienceAlert[] = [];
  let id = 0;

  for (const [cat, circuit] of Object.entries(status.circuits)) {
    const category = cat as EndpointCategory;
    if (category === 'telemetry') continue;
    const label = CATEGORY_LABELS[category];

    if (circuit.state === 'OPEN') {
      alerts.push({
        id: id++,
        kind: 'server-down',
        category,
        message: `${label} unavailable — trying again shortly`,
      });
    } else if (circuit.state === 'HALF_OPEN') {
      alerts.push({
        id: id++,
        kind: 'reconnecting',
        category,
        message: `${label} reconnecting...`,
      });
    }
  }

  for (const [cat, throttle] of Object.entries(status.throttles)) {
    const category = cat as EndpointCategory;
    if (category === 'telemetry') continue;
    if (throttle.state === 'THROTTLED') {
      alerts.push({
        id: id++,
        kind: 'degraded',
        category,
        message: 'Server is responding slowly — some features may be delayed',
      });
    }
  }

  return alerts;
}

export const useResilienceStatus = create<ResilienceUIStore>((set, get) => {
  const initial = getResilienceState();
  const initCircuits = {} as Record<EndpointCategory, CircuitState>;
  const initThrottles = {} as Record<EndpointCategory, ThrottleState>;
  for (const [cat, c] of Object.entries(initial.circuits)) {
    initCircuits[cat as EndpointCategory] = c.state;
  }
  for (const [cat, t] of Object.entries(initial.throttles)) {
    initThrottles[cat as EndpointCategory] = t.state;
  }

  return {
    alerts: buildAlerts(initial),
    toasts: [],
    _prevCircuits: initCircuits,
    _prevThrottles: initThrottles,

    dismissToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

    _handleUpdate: (status) => {
      const { _prevCircuits, _prevThrottles } = get();
      const newToasts: RecoveryToast[] = [];

      for (const [cat, circuit] of Object.entries(status.circuits)) {
        const category = cat as EndpointCategory;
        if (category === 'telemetry') continue;
        const prev = _prevCircuits[category];
        const label = CATEGORY_LABELS[category];

        if (circuit.state === 'CLOSED' && (prev === 'OPEN' || prev === 'HALF_OPEN')) {
          newToasts.push({ id: ++toastCounter, message: `${label} restored` });
        }
      }

      for (const [cat, throttle] of Object.entries(status.throttles)) {
        const category = cat as EndpointCategory;
        if (category === 'telemetry') continue;
        const prev = _prevThrottles[category];

        if (throttle.state === 'NORMAL' && prev === 'THROTTLED') {
          newToasts.push({ id: ++toastCounter, message: 'Server response times recovered' });
        }
      }

      const nextCircuits = {} as Record<EndpointCategory, CircuitState>;
      const nextThrottles = {} as Record<EndpointCategory, ThrottleState>;
      for (const [cat, c] of Object.entries(status.circuits)) {
        nextCircuits[cat as EndpointCategory] = c.state;
      }
      for (const [cat, t] of Object.entries(status.throttles)) {
        nextThrottles[cat as EndpointCategory] = t.state;
      }

      set(s => ({
        alerts: buildAlerts(status),
        toasts: [...s.toasts, ...newToasts],
        _prevCircuits: nextCircuits,
        _prevThrottles: nextThrottles,
      }));
    },
  };
});

let unsubscribe: (() => void) | undefined;

export function initResilienceUI(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeResilience(useResilienceStatus.getState()._handleUpdate);
}
