import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { WalletInterface } from '@bsv/sdk';

// jsdom's window.location is non-configurable, so navigation goes through this seam.
vi.mock('@/lib/navigateToLogin', () => ({ navigateToLogin: vi.fn() }));
vi.mock('@shared/authProof', () => ({
  authClient: { createAuthProof: vi.fn(async () => ({ sig: 'stub-proof' })) },
}));

import { navigateToLogin } from '@/lib/navigateToLogin';
import { apiFetch } from '@/lib/apiFetch';
import { apiFetchStepUp } from '@/lib/apiFetchStepUp';

const mockNavigate = vi.mocked(navigateToLogin);
const wallet = {
  getPublicKey: vi.fn(async () => ({ publicKey: '02identity' })),
} as unknown as WalletInterface;

function stubFetch(status: number) {
  const fn = vi.fn(async () => new Response('{}', { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const lastCall = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls[0] as unknown as [string, RequestInit];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/dashboard');
});

describe('apiFetch', () => {
  test('sends credentials so the session cookie rides a cross-origin request', async () => {
    const fetchMock = stubFetch(200);
    await apiFetch('/api/properties');
    expect(lastCall(fetchMock)[1].credentials).toBe('include');
  });

  test('prefixes VITE_API_BASE, without doubling the slash', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com/');
    vi.resetModules();
    const { apiFetch: freshApiFetch } = await import('@/lib/apiFetch');
    const fetchMock = stubFetch(200);
    await freshApiFetch('/api/properties');
    expect(lastCall(fetchMock)[0]).toBe('https://api.example.com/api/properties');
  });

  test('redirects to /login on 401', async () => {
    stubFetch(401);
    await apiFetch('/api/my-shares');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('does NOT redirect when already on /login', async () => {
    window.history.replaceState({}, '', '/login');
    stubFetch(401);
    await apiFetch('/api/auth/login');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('returns the response unchanged on success', async () => {
    stubFetch(200);
    expect((await apiFetch('/api/properties')).status).toBe(200);
  });
});

describe('apiFetchStepUp', () => {
  // The paired direction of the apiFetch 401 test above: a step-up caller may already
  // have broadcast an output whose nonce lives only in this page (finding C-5), so it
  // must get the 401 back instead of being teleported to /login.
  test('does NOT redirect on 401 and hands the response to the caller', async () => {
    stubFetch(401);
    const res = await apiFetchStepUp('/api/create-property', wallet, 'create-property');
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  test('POSTs credentialed JSON carrying the proof and walletIdentityKey', async () => {
    const fetchMock = stubFetch(200);
    await apiFetchStepUp('/api/my-shares', wallet, 'fetch-my-shares', { extra: 1 });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/my-shares');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({
      extra: 1,
      proof: { sig: 'stub-proof' },
      walletIdentityKey: '02identity',
    });
  });
});
