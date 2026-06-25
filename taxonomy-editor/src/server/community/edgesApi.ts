/**
 * Edges API response helpers.
 *
 * The edges file (~19 MB) carries large per-edge `rationale` strings (~7 MB
 * total). List and mutation responses strip them so clients get a ~37% smaller
 * payload; the in-memory cache and on-disk file keep full data, and full
 * rationale is served per-edge via GET /api/edges/:index. Kept pure so it can
 * be unit-tested without booting the HTTP server.
 */

export type EdgesData = { edges: Record<string, unknown>[]; [k: string]: unknown };

/**
 * Return a shallow copy of the edges file with `rationale` removed from every
 * edge. Non-object / missing-edges input is returned unchanged (defensive — the
 * caller may pass a null cache or an unexpected shape).
 */
export function stripEdgeRationale(data: unknown): unknown {
  const d = data as EdgesData | null;
  if (!d || !Array.isArray(d.edges)) return data;
  return { ...d, edges: d.edges.map(({ rationale, ...rest }) => rest) };
}
