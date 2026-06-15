// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

const isWeb = process.env.VITE_TARGET === 'web';

export default defineConfig({
  plugins: [
    react(),
    ...(isWeb ? [VitePWA({
      registerType: 'prompt',
      workbox: {
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
  base: './',
  define: {
    // Expose build target to renderer code
    'import.meta.env.VITE_TARGET': JSON.stringify(process.env.VITE_TARGET || 'electron'),
    __APP_VERSION__: JSON.stringify(require('./package.json').version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMPONENT_VERSIONS__: JSON.stringify({
      react: require('react/package.json').version,
      zustand: require('zustand/package.json').version,
      vite: require('vite/package.json').version,
      typescript: require('typescript/package.json').version,
    }),
  },
  resolve: {
    alias: {
      '@bridge': isWeb
        ? path.resolve(__dirname, 'src/renderer/bridge/web-bridge.ts')
        : path.resolve(__dirname, 'src/renderer/bridge/index.ts'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@lib/debate': path.resolve(__dirname, '../lib/debate'),
      '@lib/dictionary': path.resolve(__dirname, '../lib/dictionary'),
      '@lib/translation': path.resolve(__dirname, '../lib/translation'),
      '@lib/flight-recorder': path.resolve(__dirname, '../lib/flight-recorder'),
      '@lib/diff': path.resolve(__dirname, '../lib/diff'),
      '@lib/ai-client': path.resolve(__dirname, '../lib/ai-client'),
      // Allow lib/ files to resolve packages from taxonomy-editor's node_modules
      'zod': path.resolve(__dirname, 'node_modules/zod'),
      'jszip': path.resolve(__dirname, 'node_modules/jszip'),
    },
    // Ensure shared lib files (lib/electron-shared/) resolve React from this project
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    minify: isWeb ? false : true, // unminified for web/container to get readable errors
  },
  test: {
    include: [
      '**/*.test.{ts,tsx}',
      '../server/__tests__/**/*.test.ts',
      '../../../lib/debate/**/*.test.ts',
      // dictionary lint tests excluded — data consistency checks owned by data team
      '../../../lib/diff/**/*.test.ts',
      '../../../lib/flight-recorder/**/*.test.ts',
      '../../../lib/search/**/*.test.ts',
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
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
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
