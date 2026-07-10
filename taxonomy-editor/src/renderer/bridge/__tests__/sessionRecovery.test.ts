import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResilientFetch = vi.fn<(path: string, init: RequestInit, opts: unknown) => Promise<Response>>();

vi.mock('../resilience', () => ({
  resilientFetch: (...args: unknown[]) => mockResilientFetch(args[0] as string, args[1] as RequestInit, args[2]),
  categorizeEndpoint: () => 'data',
  registerConnectionPoolProvider: vi.fn(),
  getResilienceState: vi.fn(),
  subscribeResilience: vi.fn(),
  resetResilience: vi.fn(),
}));

vi.mock('@lib/debate/errors', () => ({
  ActionableError: class ActionableError extends Error {
    goal: string;
    problem: string;
    location: string;
    nextSteps: string[];
    httpStatus?: number;
    constructor(opts: { goal: string; problem: string; location: string; nextSteps: string[] }) {
      super(opts.problem);
      this.name = 'ActionableError';
      this.goal = opts.goal;
      this.problem = opts.problem;
      this.location = opts.location;
      this.nextSteps = opts.nextSteps;
    }
  },
}));

const mockRecord = vi.fn();
vi.mock('@lib/flight-recorder/index', () => ({
  getGlobalRecorder: () => ({ record: mockRecord }),
}));

vi.mock('../instrumentBridge', () => ({
  instrumentBridge: (raw: unknown) => raw,
}));

vi.mock('../../utils/keyShareCrypto', () => ({
  encryptKeysForSharing: vi.fn(),
  decryptKeysFromSharing: vi.fn(),
}));

vi.mock('../../hooks/useQuotaWarning', () => ({
  onQuotaMilestone: vi.fn(),
}));

const mockGlobalFetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal('fetch', mockGlobalFetch);

function mockResponse(status: number, body: unknown = {}, headers?: Record<string, string>): Response {
  const h = new Headers(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    clone() { return mockResponse(status, body, headers); },
  } as unknown as Response;
}

describe('session recovery (t/1476)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobalFetch.mockResolvedValue(mockResponse(200));
  });

  it('detects 401 no_session, recovers, and retries once (AC#1)', async () => {
    const noSessionResponse = mockResponse(401, { error: 'Anonymous session required', reason: 'no_session' });
    const okResponse = mockResponse(200, { status: 'ok' });
    mockResilientFetch
      .mockResolvedValueOnce(noSessionResponse)
      .mockResolvedValueOnce(okResponse);

    const { bridgeGet } = await import('../web-bridge');
    const result = await bridgeGet('/api/health');

    expect(result).toEqual({ status: 'ok' });
    expect(mockResilientFetch).toHaveBeenCalledTimes(2);
    expect(mockGlobalFetch).toHaveBeenCalledWith(
      '/api/auth/anonymous',
      expect.objectContaining({ method: 'POST', credentials: 'include', cache: 'no-store' }),
    );
  });

  it('surfaces error when retry also fails — no loop (AC#2)', async () => {
    const noSessionResponse = mockResponse(401, { error: 'Anonymous session required', reason: 'no_session' });
    mockResilientFetch.mockResolvedValue(noSessionResponse);

    const { bridgeGet } = await import('../web-bridge');
    await expect(bridgeGet('/api/taxonomy/accelerationist')).rejects.toThrow();
    expect(mockResilientFetch).toHaveBeenCalledTimes(2);
    expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent recovery attempts (AC concurrency)', async () => {
    const noSession = mockResponse(401, { error: 'Anonymous session required', reason: 'no_session' });
    const ok = mockResponse(200, { data: 'ok' });

    let callCount = 0;
    mockResilientFetch.mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) return noSession;
      return ok;
    });

    let resolveRecovery!: (v: Response) => void;
    mockGlobalFetch.mockImplementation(() => new Promise<Response>(r => { resolveRecovery = r; }));

    const { bridgeGet } = await import('../web-bridge');
    const p1 = bridgeGet('/api/health').catch(() => 'failed');
    const p2 = bridgeGet('/api/taxonomy/accelerationist').catch(() => 'failed');

    await vi.waitFor(() => expect(mockGlobalFetch).toHaveBeenCalledTimes(1));
    resolveRecovery(mockResponse(200));
    await Promise.all([p1, p2]);

    expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
  });

  it('does not attempt recovery for non-401 errors', async () => {
    mockResilientFetch.mockResolvedValue(mockResponse(500, { error: 'Internal server error' }));

    const { bridgeGet } = await import('../web-bridge');
    await expect(bridgeGet('/api/health')).rejects.toThrow();
    expect(mockGlobalFetch).not.toHaveBeenCalled();
  });

  it('does not attempt recovery for 401 without no_session reason', async () => {
    mockResilientFetch.mockResolvedValue(mockResponse(401, { error: 'Unauthorized' }));

    const { bridgeGet } = await import('../web-bridge');
    await expect(bridgeGet('/api/health')).rejects.toThrow();
    expect(mockGlobalFetch).not.toHaveBeenCalled();
  });

  it('surfaces error when recovery fetch itself fails (condition #2)', async () => {
    const noSession = mockResponse(401, { error: 'Anonymous session required', reason: 'no_session' });
    mockResilientFetch.mockResolvedValue(noSession);
    mockGlobalFetch.mockRejectedValue(new Error('Network error'));

    const { bridgeGet } = await import('../web-bridge');
    await expect(bridgeGet('/api/health')).rejects.toThrow();
    expect(mockResilientFetch).toHaveBeenCalledTimes(1);
  });
});
