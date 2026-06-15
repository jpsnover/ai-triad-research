// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Minimal NumPy .npy parser for 2D float32 arrays.
 * Supports format v1 and v2. Returns a flat Float32Array and shape metadata.
 */
export function parseNpy(buffer: Buffer): { shape: [number, number]; data: Float32Array } {
  if (buffer.length < 10 || buffer[0] !== 0x93 || buffer[1] !== 0x4E) {
    throw new Error('Not a valid .npy file');
  }

  const major = buffer[6];
  let headerLen: number;
  let headerStart: number;

  if (major <= 1) {
    headerLen = buffer.readUInt16LE(8);
    headerStart = 10;
  } else {
    headerLen = buffer.readUInt32LE(8);
    headerStart = 12;
  }

  const dataOffset = headerStart + headerLen;
  const header = buffer.subarray(headerStart, dataOffset).toString('ascii');

  const shapeMatch = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  if (!shapeMatch) throw new Error('Cannot parse shape from .npy header: ' + header);

  const rows = parseInt(shapeMatch[1]);
  const cols = parseInt(shapeMatch[2]);

  const descrMatch = header.match(/'descr':\s*'([^']+)'/);
  const descr = descrMatch?.[1] ?? '<f4';
  if (descr !== '<f4') throw new Error(`Unsupported dtype: ${descr} (expected float32 / <f4)`);

  const expected = rows * cols * 4;
  if (buffer.length - dataOffset < expected) {
    throw new Error(`NPY data truncated: expected ${expected} bytes, got ${buffer.length - dataOffset}`);
  }

  const aligned = Buffer.alloc(expected);
  buffer.copy(aligned, 0, dataOffset, dataOffset + expected);
  const data = new Float32Array(aligned.buffer, aligned.byteOffset, rows * cols);

  return { shape: [rows, cols], data };
}

/**
 * Extract per-node vectors from a parsed NPY file using an index map.
 * Index format: { [nodeId]: { start: number, count: number } }
 */
export function extractNodeVectors(
  parsed: { shape: [number, number]; data: Float32Array },
  index: Record<string, { start: number; count: number }>,
  pov: string,
): Record<string, { pov: string; vectors: number[][] }> {
  const [, cols] = parsed.shape;
  const result: Record<string, { pov: string; vectors: number[][] }> = {};

  for (const [nodeId, { start, count }] of Object.entries(index)) {
    const vectors: number[][] = [];
    for (let i = 0; i < count; i++) {
      const offset = (start + i) * cols;
      vectors.push(Array.from(parsed.data.subarray(offset, offset + cols)));
    }
    result[nodeId] = { pov, vectors };
  }

  return result;
}
