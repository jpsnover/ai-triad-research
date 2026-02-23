import { useState, useEffect, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

// Global toast state (simple event-based approach)
const listeners: Array<(toasts: ToastMessage[]) => void> = [];
let toasts: ToastMessage[] = [];

function notify() {
  for (const listener of listeners) {
    listener([...toasts]);
  }
}

export function showToast(type: ToastType, message: string): void {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
  toasts = [...toasts, { id, type, message }];
  notify();

  // Auto-dismiss after 5s
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  }, 5000);
}

export default function ToastContainer() {
  const [currentToasts, setCurrentToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    listeners.push(setCurrentToasts);
    return () => {
      const idx = listeners.indexOf(setCurrentToasts);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  }, []);

  if (currentToasts.length === 0) return null;

  return (
    <div className="toast-container">
      {currentToasts.map(toast => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          onClick={() => dismiss(toast.id)}
        >
          <span className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '!'}
            {toast.type === 'info' && 'i'}
          </span>
          <span className="toast-message">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
