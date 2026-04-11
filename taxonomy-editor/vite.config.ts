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
  },
  resolve: {
    alias: {
      '@bridge': isWeb
        ? path.resolve(__dirname, 'src/renderer/bridge/web-bridge.ts')
        : path.resolve(__dirname, 'src/renderer/bridge/index.ts'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@lib/debate': path.resolve(__dirname, '../lib/debate'),
      // Allow lib/debate/ files to resolve zod from taxonomy-editor's node_modules
      'zod': path.resolve(__dirname, 'node_modules/zod'),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    minify: isWeb ? false : true, // unminified for web/container to get readable errors
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
});
