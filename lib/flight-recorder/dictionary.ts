// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { DictionaryEntry } from './types.js';

const MAX_ENTRIES = 4096;
const MIN_INTERN_LENGTH = 9;  // Strings ≤8 chars are never interned

/**
 * Constant-pool dictionary that interns frequently-used strings and returns
 * small integer handles. Thread-safe by JS single-thread guarantee.
 */
export class Dictionary {
  private entries: DictionaryEntry[] = [];
  private lookup = new Map<string, number>();  // "category\0value" → handle

  /** Returns total registered entries. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Register a string and return its handle, or the raw string if it's too
   * short to benefit from interning or the dictionary is full.
   */
  intern(category: string, value: string): number | string {
    if (value.length < MIN_INTERN_LENGTH) return value;

    const key = category + '\0' + value;
    const existing = this.lookup.get(key);
    if (existing !== undefined) return existing;

    if (this.entries.length >= MAX_ENTRIES) return value;

    const handle = this.entries.length;
    const entry: DictionaryEntry = {
      handle,
      category,
      value,
      registered_at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
    this.entries.push(entry);
    this.lookup.set(key, handle);
    return handle;
  }

  /** Resolve a handle to its full string. Returns the input unchanged if it's already a string. */
  resolve(ref: number | string): string {
    if (typeof ref === 'string') return ref;
    const entry = this.entries[ref];
    return entry ? entry.value : `<unknown:${ref}>`;
  }

  /** Return all entries (for dump serialization). */
  getEntries(): readonly DictionaryEntry[] {
    return this.entries;
  }

  /** Reset all entries. Primarily for testing. */
  clear(): void {
    this.entries = [];
    this.lookup.clear();
  }
}
