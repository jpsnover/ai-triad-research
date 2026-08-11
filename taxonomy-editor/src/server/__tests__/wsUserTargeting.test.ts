// @vitest-environment node

/**
 * t/2443 — per-user WebSocket targeting: generate-text-progress isolation.
 *
 * server.ts maintains a Map<userId, Set<WebSocket>> (`userEventClients`) to deliver
 * generate-text-progress events only to the requesting user's connections.
 * server.ts itself is not import-testable; these tests validate the data-structure
 * contract the implementation must satisfy: session isolation, lifecycle cleanup,
 * no-op safety, and anonymous-user exclusion.
 *
 * TL test cases t/2443#3: AC#2 (two-client isolation), AC#3 (no-op), AC#4 (anon).
 */
import { describe, it, expect } from 'vitest';

const WS_OPEN = 1;   // WebSocket.OPEN
const WS_CLOSED = 3; // WebSocket.CLOSED

type MockSocket = { readyState: number; received: string[]; send(msg: string): void };

function makeSocket(open = true): MockSocket {
  const received: string[] = [];
  return {
    readyState: open ? WS_OPEN : WS_CLOSED,
    received,
    send(msg) { if (this.readyState === WS_OPEN) received.push(msg); },
  };
}

// Inline the same Map/Set logic used by server.ts for userEventClients + emitToUser.
// Divergence from this contract in server.ts is a regression.
function makeRegistry() {
  const userClients = new Map<string, Set<MockSocket>>();

  function register(userId: string, ws: MockSocket) {
    if (!userClients.has(userId)) userClients.set(userId, new Set());
    userClients.get(userId)!.add(ws);
  }

  function deregister(userId: string, ws: MockSocket) {
    const s = userClients.get(userId);
    if (s) { s.delete(ws); if (!s.size) userClients.delete(userId); }
  }

  function emitToUser(userId: string, type: string, data: unknown) {
    const msg = JSON.stringify({ type, data });
    userClients.get(userId)?.forEach(ws => { if (ws.readyState === WS_OPEN) ws.send(msg); });
  }

  return { register, deregister, emitToUser, has: (u: string) => userClients.has(u), size: (u: string) => userClients.get(u)?.size ?? 0 };
}

const PROGRESS = { attempt: 1, maxRetries: 3, backoffSeconds: 5, limitType: 'rpm', limitMessage: 'retry' };
const MSG = JSON.stringify({ type: 'generate-text-progress', data: PROGRESS });

describe('emitToUser — session isolation (t/2443 AC#2)', () => {
  it('delivers only to the requesting user, not to a bystander', () => {
    const reg = makeRegistry();
    const alice = makeSocket();
    const bob = makeSocket();

    reg.register('alice@example.com', alice);
    reg.register('bob@example.com', bob);

    reg.emitToUser('alice@example.com', 'generate-text-progress', PROGRESS);

    expect(alice.received).toEqual([MSG]);
    expect(bob.received).toHaveLength(0);
  });

  it('delivers to all sockets of the same user when they have multiple tabs open', () => {
    const reg = makeRegistry();
    const ws1 = makeSocket();
    const ws2 = makeSocket();

    reg.register('alice@example.com', ws1);
    reg.register('alice@example.com', ws2);

    reg.emitToUser('alice@example.com', 'generate-text-progress', PROGRESS);

    expect(ws1.received).toEqual([MSG]);
    expect(ws2.received).toEqual([MSG]);
  });
});

describe('emitToUser — no-op safety (t/2443 AC#3)', () => {
  it('is a no-op for an unregistered userId — no throw', () => {
    const reg = makeRegistry();
    expect(() => reg.emitToUser('nobody@example.com', 'generate-text-progress', PROGRESS)).not.toThrow();
  });

  it('does not deliver to a closed socket, even if still in the registry', () => {
    const reg = makeRegistry();
    const ws = makeSocket(false); // closed (WS_CLOSED = 3)

    reg.register('alice@example.com', ws);
    reg.emitToUser('alice@example.com', 'generate-text-progress', PROGRESS);

    expect(ws.received).toHaveLength(0);
  });
});

describe('deregister — close/error lifecycle (t/2443 AC#3)', () => {
  it('removes the Map entry when the last socket closes', () => {
    const reg = makeRegistry();
    const ws = makeSocket();

    reg.register('alice@example.com', ws);
    expect(reg.has('alice@example.com')).toBe(true);

    reg.deregister('alice@example.com', ws);
    expect(reg.has('alice@example.com')).toBe(false);
  });

  it('keeps the entry when other sockets remain after one closes', () => {
    const reg = makeRegistry();
    const ws1 = makeSocket();
    const ws2 = makeSocket();

    reg.register('alice@example.com', ws1);
    reg.register('alice@example.com', ws2);
    reg.deregister('alice@example.com', ws1);

    expect(reg.has('alice@example.com')).toBe(true);
    expect(reg.size('alice@example.com')).toBe(1);
  });
});

describe('anonymous WS clients — not registered (t/2443 AC#4)', () => {
  it('null userId (hosted anonymous) is never registered — registration gate matches server.ts `if (userId)`', () => {
    const reg = makeRegistry();

    // server.ts upgrade handler: `const userId = getWebSocketUserId(req)`
    // then `if (userId) { ... register ... }`. null → never registered.
    const userId: string | null = null;
    if (userId) reg.register(userId, makeSocket());

    expect(reg.has('')).toBe(false);
    // emitToUser to '' (the null-coalesced path) is a silent no-op
    expect(() => reg.emitToUser('', 'generate-text-progress', PROGRESS)).not.toThrow();
  });
});
