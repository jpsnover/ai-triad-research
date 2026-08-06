// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Bootstrap script — runs BEFORE React loads.
// Catches module-level import crashes (e.g. Node.js modules in browser)
// and shows a user-friendly error screen instead of a blank white window.

// A "Failed to fetch dynamically imported module" error means the dev server
// couldn't be reached — a network/address-family issue, NOT a code fault.
// Distinguishing it avoids sending diagnosers down the wrong path (t/1590).
function isNetworkFetchFailure(msg: string): boolean {
  return /failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showReconnectingScreen(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;padding:40px;font-family:system-ui,sans-serif;color:#e0e0e0;
      background:#1a1a2e;text-align:center;
    ">
      <div style="font-size:36px;margin-bottom:16px;animation:spin 1.2s linear infinite">↻</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      <h1 style="font-size:1.4rem;margin:0 0 8px">Reconnecting to dev server…</h1>
      <p style="color:#aaa;margin:0;max-width:600px;font-size:0.9rem">
        Vite is restarting (e.g. after a <code style="color:#8fd">package.json</code> change).
        Will reload automatically when it comes back.
      </p>
    </div>
  `;
}

function showCrashScreen(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? '' : '';
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;padding:40px;font-family:system-ui,sans-serif;color:#e0e0e0;
      background:#1a1a2e;text-align:center;
    ">
      <div style="font-size:48px;margin-bottom:16px">⚠</div>
      <h1 style="font-size:1.4rem;margin:0 0 8px">Cannot reach the dev server</h1>
      <p style="color:#aaa;margin:0 0 16px;max-width:600px;font-size:0.9rem">
        The renderer couldn't load its modules from the Vite dev server. The server may
        not be running, or it bound an address family (IPv4/IPv6) the app isn't connecting to.
        Check that <code style="color:#8fd">npm run dev</code> is running and serving on 127.0.0.1:5173.
      </p>
      <pre style="
        text-align:left;background:#12122a;border:1px solid #333;border-radius:8px;
        padding:16px;max-width:700px;width:100%;overflow-x:auto;font-size:0.8rem;
        color:#ff6b6b;margin:0 0 20px;white-space:pre-wrap;word-break:break-word;
      ">${escapeHtml(msg)}${stack ? '\n\n' + escapeHtml(stack) : ''}</pre>
      <div style="display:flex;gap:12px">
        <button onclick="location.reload()" style="
          padding:8px 20px;border-radius:6px;border:none;background:#4a90d9;
          color:#fff;font-size:0.9rem;cursor:pointer;
        ">Reload</button>
        <span style="
          padding:8px 16px;border-radius:6px;border:1px solid #555;
          color:#777;font-size:0.8rem;
        ">DevTools: Ctrl+Shift+I</span>
      </div>
    </div>
  `;
}

function showGenericCrashScreen(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? '' : '';
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;padding:40px;font-family:system-ui,sans-serif;color:#e0e0e0;
      background:#1a1a2e;text-align:center;
    ">
      <div style="font-size:48px;margin-bottom:16px">⚠</div>
      <h1 style="font-size:1.4rem;margin:0 0 8px">Taxonomy Editor failed to start</h1>
      <p style="color:#aaa;margin:0 0 16px;max-width:600px;font-size:0.9rem">
        A module failed to load. This usually means a shared library imported
        a Node.js-only module in the renderer process.
      </p>
      <pre style="
        text-align:left;background:#12122a;border:1px solid #333;border-radius:8px;
        padding:16px;max-width:700px;width:100%;overflow-x:auto;font-size:0.8rem;
        color:#ff6b6b;margin:0 0 20px;white-space:pre-wrap;word-break:break-word;
      ">${escapeHtml(msg)}${stack ? '\n\n' + escapeHtml(stack) : ''}</pre>
      <div style="display:flex;gap:12px">
        <button onclick="location.reload()" style="
          padding:8px 20px;border-radius:6px;border:none;background:#4a90d9;
          color:#fff;font-size:0.9rem;cursor:pointer;
        ">Reload</button>
        <span style="
          padding:8px 16px;border-radius:6px;border:1px solid #555;
          color:#777;font-size:0.8rem;
        ">DevTools: Ctrl+Shift+I</span>
      </div>
    </div>
  `;
}

// Probe the dev server until it responds or timeout elapses.
// Returns true if the server came back up, false on timeout.
// bare-fetch exception: bootstrap.ts runs before React and web-bridge.ts are loaded —
// the bridge cannot exist here (same rationale as flightRecorderInit.ts).
async function waitForDevServer(timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      /* telemetry — silent by design */ // bootstrap.ts pre-dates module init; getGlobalRecorder unavailable
    }
    await new Promise<void>((r) => setTimeout(r, 400));
  }
  return false;
}

// For network failures: show reconnecting UI, auto-reload if Vite comes back
// within 5 s, otherwise fall through to the static "server not running" screen.
async function handleNetworkError(error: unknown): Promise<void> {
  showReconnectingScreen();
  const recovered = await waitForDevServer(5000);
  if (recovered) {
    location.reload();
  } else {
    showCrashScreen(error);
  }
}

function handleError(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  if (isNetworkFetchFailure(msg)) {
    void handleNetworkError(error);
  } else {
    showGenericCrashScreen(error);
  }
}

// Catch synchronous import errors and unhandled promise rejections
window.addEventListener('error', (e) => {
  if (e.error && !document.getElementById('root')?.children.length) {
    handleError(e.error);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (!document.getElementById('root')?.children.length) {
    handleError(e.reason);
  }
});

// Tag body with runtime target so CSS can gate Electron-only rules
if (import.meta.env.VITE_TARGET !== 'web') {
  document.body.classList.add('electron');
}

// Dynamic import so that if App's transitive imports crash,
// the error handlers above are already registered.
import('./index').catch(handleError);
