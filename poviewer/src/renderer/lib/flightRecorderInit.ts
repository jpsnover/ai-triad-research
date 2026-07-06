import { FlightRecorder, setGlobalRecorder, getGlobalRecorder } from '@lib/flight-recorder/index';

export function initFlightRecorder(): void {
  const recorder = new FlightRecorder({ capacity: 2000, dumpOnError: true });
  setGlobalRecorder(recorder);

  window.addEventListener('error', (event) => {
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'poviewer',
      level: 'fatal',
      message: event.message,
      error: {
        name: 'UncaughtError',
        message: event.message,
        stack: event.error?.stack,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
    getGlobalRecorder()?.record({
      type: 'system.error',
      component: 'poviewer',
      level: 'error',
      message: msg,
      error: {
        name: 'UnhandledRejection',
        message: msg,
        stack: event.reason instanceof Error ? event.reason.stack : undefined,
      },
    });
  });

  if (import.meta.env.DEV) {
    (window as unknown as { __flightRecorder: FlightRecorder }).__flightRecorder = recorder;
  }
}
