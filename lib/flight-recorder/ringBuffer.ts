// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { FlightRecorderEvent } from './types.js';

/**
 * Fixed-capacity circular buffer with overwrite-oldest semantics.
 * Single-threaded (JS main thread) — no lock-free complexity needed.
 */
export class RingBuffer {
  private slots: (FlightRecorderEvent | null)[];
  private writeIndex = 0;
  readonly capacity: number;

  /** Total events written (monotonically increasing, used for _seq). */
  count = 0;

  /** Sequence number of the oldest surviving event. */
  get oldestSeq(): number {
    if (this.count === 0) return 0;
    return this.count <= this.capacity ? 0 : this.count - this.capacity;
  }

  /** Number of events currently retained. */
  get retained(): number {
    return Math.min(this.count, this.capacity);
  }

  constructor(capacity: number) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
  }

  /** Write an event into the next slot, overwriting the oldest if full. */
  write(event: FlightRecorderEvent): void {
    this.slots[this.writeIndex] = event;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.count++;
  }

  /**
   * Drain all retained events in sequence order (oldest first).
   * Does not clear the buffer — this is a read-only snapshot.
   */
  drain(): FlightRecorderEvent[] {
    if (this.count === 0) return [];

    const retained = this.retained;
    const result: FlightRecorderEvent[] = [];

    // Start reading from the oldest event position
    const startIndex = this.count <= this.capacity
      ? 0
      : this.writeIndex;  // writeIndex points to the oldest slot after wrap

    for (let i = 0; i < retained; i++) {
      const slot = this.slots[(startIndex + i) % this.capacity];
      if (slot) result.push(slot);
    }

    return result;
  }

  /** Reset the buffer. Primarily for testing. */
  clear(): void {
    this.slots.fill(null);
    this.writeIndex = 0;
    this.count = 0;
  }
}
