// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { z } from 'zod';
import { ipcMain } from 'electron';

/**
 * Register an IPC handler with Zod argument validation.
 * Renderer args are validated as a tuple schema.
 * Invalid payloads throw with a descriptive error (never crash silently).
 */
export function validatedHandle(
  channel: string,
  argsSchema: z.ZodType,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, (event, ...rawArgs: unknown[]) => {
    const result = argsSchema.safeParse(rawArgs);
    if (!result.success) {
      const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.error(`[IPC] Validation failed for '${channel}': ${msg}`);
      throw new Error(`Invalid IPC payload for '${channel}': ${msg}`);
    }
    return handler(event, ...(result.data as unknown[]));
  });
}

// ── Common argument schemas ─────────────────────────────────────────────────

/** No arguments */
export const noArgs = z.tuple([]);

/** Single string argument */
export const oneString = z.tuple([z.string()]);

/** Two string arguments */
export const twoStrings = z.tuple([z.string(), z.string()]);

/** Single string array argument */
export const stringArray = z.tuple([z.array(z.string())]);

/** String + unknown (e.g., save with ID + data) */
export const stringAndUnknown = z.tuple([z.string(), z.unknown()]);

/** String array + string */
export const stringArrayAndString = z.tuple([z.array(z.string()), z.string()]);

/** Single unknown argument */
export const oneUnknown = z.tuple([z.unknown()]);

/** Optional single string */
export const optionalString = z.tuple([]).rest(z.string());

/** String + optional string */
export const stringAndOptionalString = z.tuple([z.string()]).rest(z.string());

/** Two strings + optional string */
export const twoStringsAndOptional = z.tuple([z.string(), z.string()]).rest(z.string());

/** String + record of unknown values */
export const stringAndRecord = z.tuple([z.string(), z.record(z.string(), z.unknown())]);

/** Single array of unknown */
export const unknownArray = z.tuple([z.array(z.unknown())]);
