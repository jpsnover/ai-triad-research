// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
