// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import fs from 'fs/promises';
import path from 'path';
import type { StorageBackend } from './storageBackend';

/**
 * FilesystemBackend — local disk implementation of StorageBackend.
 *
 * Used by default (Electron + local dev) and in the Azure container when
 * the data volume is mounted.  All methods handle missing files/dirs
 * gracefully (no throws for ENOENT).
 */
export class FilesystemBackend implements StorageBackend {
  async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      return await fs.readdir(dirPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      // ENOTDIR: path exists but is a file, not a directory
      if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
      throw err;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
