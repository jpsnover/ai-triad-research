// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

// Bootstrap script — runs BEFORE React loads.
// Catches module-level import crashes (e.g. Node.js modules in browser)
// and shows a user-friendly error screen instead of a blank white window.

function showCrashScreen(error: unknown) {
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
        <button onclick="try{require('electron').ipcRenderer.send('open-devtools')}catch(e){}" style="
          padding:8px 20px;border-radius:6px;border:1px solid #555;background:transparent;
          color:#aaa;font-size:0.9rem;cursor:pointer;
        ">Open DevTools</button>
      </div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Catch synchronous import errors and unhandled promise rejections
window.addEventListener('error', (e) => {
  if (e.error && !document.getElementById('root')?.children.length) {
    showCrashScreen(e.error);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (!document.getElementById('root')?.children.length) {
    showCrashScreen(e.reason);
  }
});

// Tag body with runtime target so CSS can gate Electron-only rules
if (import.meta.env.VITE_TARGET !== 'web') {
  document.body.classList.add('electron');
}

// Dynamic import so that if App's transitive imports crash,
// the error handlers above are already registered.
import('./index.tsx').catch(showCrashScreen);
