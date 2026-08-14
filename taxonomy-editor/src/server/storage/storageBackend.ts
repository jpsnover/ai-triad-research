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
  /** Short identity string for structured logs (e.g. 'filesystem', 'azure-blob', 'github-api'). */
  readonly backendName: string;

  /** Read a file as UTF-8. Returns null if the file does not exist.
   *  `opts.ref` pins the read to a specific ref (e.g. 'main') for shared data
   *  that lives on main rather than a per-user session branch (community
   *  submissions, calibration logs). Backends without branches ignore it.
   *  `opts.optional` signals the file may legitimately not exist — backends
   *  that log 404s can downgrade from error to debug level. */
  readFile(filePath: string, opts?: { ref?: string; optional?: boolean }): Promise<string | null>;

  /** Write content to a file (UTF-8). Creates parent directories and uses
   *  atomic write (tmp+rename) where the backend supports it.
   *  `opts.ref` pins the write to a specific ref (e.g. 'main') for shared data
   *  that must commit straight to main rather than a per-user session branch
   *  (community submissions). Backends without branches ignore it. */
  writeFile(filePath: string, content: string, opts?: { ref?: string }): Promise<void>;

  /** List entries (files and directories) in a directory. Returns [] if the
   *  directory does not exist.
   *  `opts.ref` pins the listing to a specific ref (e.g. 'main') for shared
   *  directories that live on main rather than a per-user session branch.
   *  Backends without branches ignore it. */
  listDirectory(dirPath: string, opts?: { ref?: string }): Promise<string[]>;

  /** Delete a file. No-op if the file does not exist. */
  deleteFile(filePath: string): Promise<void>;

  /** Check whether a file or directory exists at the given path. */
  fileExists(filePath: string): Promise<boolean>;

  /** Read a file as a raw binary Buffer. Returns null if the file does not exist. */
  readBinaryFile(filePath: string): Promise<Buffer | null>;

  /** Write raw binary content to a file. Creates parent dirs; atomic where supported. */
  writeBinaryFile(filePath: string, content: Buffer, opts?: { ref?: string }): Promise<void>;
}
