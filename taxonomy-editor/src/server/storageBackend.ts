// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * StorageBackend — abstraction over raw file I/O.
 *
 * Domain logic (fileIO.ts) delegates all disk/network I/O through this
 * interface. Two implementations:
 *   - FilesystemBackend  (Electron, local dev, current behavior)
 *   - GitHubAPIBackend   (Azure container deployment — Phase 1)
 *
 * All paths are absolute. Each method handles missing files/dirs gracefully
 * (no throws for ENOENT):
 *   - readFile   → returns null if file doesn't exist
 *   - writeFile  → auto-creates parent directories, atomic (tmp+rename)
 *   - listDir    → returns [] if directory doesn't exist
 *   - deleteFile → no-op if file doesn't exist
 *   - fileExists → returns false if file doesn't exist
 */

export interface StorageBackend {
  /** Read a file as UTF-8. Returns null if the file does not exist. */
  readFile(filePath: string): Promise<string | null>;

  /** Write content to a file (UTF-8). Creates parent directories and uses
   *  atomic write (tmp+rename) where the backend supports it. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** List entries (files and directories) in a directory. Returns [] if the
   *  directory does not exist. */
  listDirectory(dirPath: string): Promise<string[]>;

  /** Delete a file. No-op if the file does not exist. */
  deleteFile(filePath: string): Promise<void>;

  /** Check whether a file or directory exists at the given path. */
  fileExists(filePath: string): Promise<boolean>;
}
