// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const isWeb = process.env.VITE_TARGET === 'web';

function getGitVersion(): string {
  try {
    return execSync('git describe --tags --always', { encoding: 'utf8' }).trim();
  } catch {
    return require('./package.json').version;
  }
}

function getGitSha(): string {
  // Container builds (Docker) inject the commit as BUILD_SHA — the build context has no
  // .git, so git exec would fall through to 'unknown' (t/2434). Prefer it when set; local
  // and Electron builds leave it unset and keep using git exec unchanged (t/2439).
  const fromEnv = process.env.BUILD_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [
    react(),
    ...(isWeb ? [VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/.auth\//],
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
      manifest: {
        name: 'Taxonomy Editor',
        short_name: 'Taxonomy',
        description: 'Multi-perspective research platform for AI policy taxonomy',
        start_url: '/',
        display: 'standalone',
        background_color: '#FAF8F5',
        theme_color: '#A51C30',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    })] : []),
  ],
  root: 'src/renderer',
  base: isWeb ? '/' : './',
  define: {
    // Expose build target to renderer code
    'import.meta.env.VITE_TARGET': JSON.stringify(process.env.VITE_TARGET || 'electron'),
    __APP_VERSION__: JSON.stringify(getGitVersion()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __BUILD_SHA__: JSON.stringify(getGitSha()),
    __CHANGELOG_MD__: JSON.stringify(
      fs.readFileSync(path.resolve(import.meta.dirname, '../CHANGELOG.md'), 'utf-8')
    ),
    __COMPONENT_VERSIONS__: JSON.stringify({
      react: require('react/package.json').version,
      zustand: require('zustand/package.json').version,
      vite: require('vite/package.json').version,
      typescript: require('typescript/package.json').version,
    }),
  },
  resolve: {
    alias: {
      // Electron build omits vite-plugin-pwa (web-only), so the plugin never
      // provides `virtual:pwa-register/react`. UpdatePrompt.tsx imports it, and
      // rolldown intermittently fails to resolve the unprovided virtual module
      // during the electron build (t/2356). Alias it to a deterministic stub so
      // resolution never races. Web build keeps the real plugin-provided module.
      ...(isWeb ? {} : { 'virtual:pwa-register/react': path.resolve(import.meta.dirname, 'src/renderer/lib/pwaRegisterStub.ts') }),
      '@bridge': isWeb
        ? path.resolve(import.meta.dirname, 'src/renderer/bridge/web-bridge.ts')
        : path.resolve(import.meta.dirname, 'src/renderer/bridge/index.ts'),
      '@renderer': path.resolve(import.meta.dirname, 'src/renderer'),
      '@lib/debate': path.resolve(import.meta.dirname, '../lib/debate'),
      '@lib/dictionary': path.resolve(import.meta.dirname, '../lib/dictionary'),
      '@lib/translation': path.resolve(import.meta.dirname, '../lib/translation'),
      '@lib/flight-recorder': path.resolve(import.meta.dirname, '../lib/flight-recorder'),
      '@lib/diff': path.resolve(import.meta.dirname, '../lib/diff'),
      '@lib/ai-client': path.resolve(import.meta.dirname, '../lib/ai-client'),
      '@lib/electron-shared': path.resolve(import.meta.dirname, '../lib/electron-shared'),
      '@lib/embeddings': path.resolve(import.meta.dirname, '../lib/embeddings'),
      '@lib/chat': path.resolve(import.meta.dirname, '../lib/chat'),
      '@lib/organizations': path.resolve(import.meta.dirname, '../lib/organizations'),
      '@lib/entities': path.resolve(import.meta.dirname, '../lib/entities'),
      '@lib/policy': path.resolve(import.meta.dirname, '../lib/policy'),
      // Allow lib/ files to resolve packages from taxonomy-editor's node_modules
      'zod': path.resolve(import.meta.dirname, 'node_modules/zod'),
      'jszip': path.resolve(import.meta.dirname, 'node_modules/jszip'),
    },
    // Ensure shared lib files (lib/electron-shared/) resolve React from this project
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    minify: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom/') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/zustand/')) return 'zustand';
          if (id.includes('node_modules/zod/')) return 'zod';
          if (id.includes('node_modules/react-markdown/') || id.includes('node_modules/remark-gfm/')) return 'markdown';
          if (id.includes('node_modules/@xterm/')) return 'xterm';
          if (id.includes('node_modules/jszip/')) return 'jszip';
        },
      },
    },
  },
  test: {
    include: [
      '**/*.test.{ts,tsx}',
      '../main/**/*.test.ts',
      '../server/__tests__/**/*.test.ts',
      '../../../lib/ai-client/**/*.test.ts',
      '../../../lib/chat/**/*.test.ts',
      '../../../lib/electron-shared/**/*.test.ts',
      '../../../lib/debate/**/*.test.ts',
      // dictionary lint tests excluded — data consistency checks owned by data team
      '../../../lib/diff/**/*.test.ts',
      '../../../lib/edges/**/*.test.ts',
      '../../../lib/flight-recorder/**/*.test.ts',
      '../../../lib/search/**/*.test.ts',
      '../../../lib/entities/**/*.test.ts',
      '../../../lib/sanitize/**/*.test.ts',
      '../../../lib/ai-config/**/*.test.ts',
      '../../../lib/embeddings/**/*.test.ts', // t/2060 — mock-based (fake onnxruntime-node), no native addon/model needed
      '../../../lib/*.test.ts',
      // translation tests excluded — depend on ai-triad-data dictionary not available in CI
    ],
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportOnFailure: true,
      thresholds: {
        statements: 17,
        branches: 11,
        functions: 23,
        lines: 18,
      },
    },
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web', 'virtual:pwa-register/react'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(import.meta.dirname, '..')],
    },
    // In web mode, proxy API + WebSocket traffic to the local server (port 7862)
    // so the web bridge's /api/* and /ws/* calls resolve. Ignored in electron mode.
    proxy: isWeb ? {
      '/api': { target: 'http://localhost:7862', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:7862',   ws: true, changeOrigin: true },
      '/health': { target: 'http://localhost:7862', changeOrigin: true },
    } : undefined,
  },
});
