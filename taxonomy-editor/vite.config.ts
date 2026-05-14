// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isWeb = process.env.VITE_TARGET === 'web';

export default defineConfig({
  plugins: [react()],
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
      '../../../lib/**/*.test.ts',
    ],
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test-setup.ts'],
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
