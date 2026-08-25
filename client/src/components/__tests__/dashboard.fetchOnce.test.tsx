/**
 * Each dashboard endpoint must be fetched ONCE per mount. Two independent causes of 2x:
 * dependency churn (ensureWallet memoized on [userWallet, userPubKey] while itself calling
 * setUserPubKey), fixed at the root; and StrictMode's dev double-invoke, which only
 * query-level dedup of identical in-flight requests removes.
 * Uses the REAL provider; mocking the context would hide the dependency churn entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

// vi.mock is hoisted above plain consts, so the wallet stubs must be hoisted too.
const wallet = vi.hoisted(() => ({
  getPublicKey: vi.fn(async () => ({ publicKey: '02deadbeef' })),
  isAuthenticated: vi.fn(async () => ({ authenticated: true })),
}));
vi.mock('@bsv/sdk', () => ({
  WalletClient: class {
    getPublicKey = wallet.getPublicKey;
    isAuthenticated = wallet.isAuthenticated;
  },
}));

const apiFetchStepUp = vi.fn();
vi.mock('@/lib/apiFetchStepUp', () => ({
  apiFetchStepUp: (...a: unknown[]) => apiFetchStepUp(...a),
}));
const apiFetch = vi.fn();
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock('@/hooks/useCancelListing', () => ({
  useCancelListing: () => ({ cancelListing: vi.fn(), cancellingId: null }),
}));
vi.mock('@/components/dashboard/SellingListings', () => ({ default: () => null }));
vi.mock('@/components/dashboard/MarketListings', () => ({ default: () => null }));
vi.mock('@/components/dashboard/PortfolioStats', () => ({ default: () => null }));

import { AuthContextProvider } from '@/context/walletContext';
import { queryClient } from '@/lib/queryClient';
import { Dashboard } from '../dashboard';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // Shared singleton: without this a cached entry would let a later case pass vacuously.
  queryClient.clear();
  apiFetchStepUp.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  apiFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    // Every step-up read is gated on this answer, so it has to say yes.
    json: async () => (String(url).includes('/api/check-session') ? { authenticated: true } : {}),
  }));
});

function renderDashboard(strict: boolean) {
  const tree = (
    <MemoryRouter>
      <AuthContextProvider>
        <QueryClientProvider client={queryClient}>
          <Dashboard />
        </QueryClientProvider>
      </AuthContextProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

async function settle() {
  await waitFor(() => expect(Object.keys(callsByPath()).length).toBeGreaterThanOrEqual(3));
  // Let any dependency- or remount-triggered re-run settle before counting.
  await new Promise((r) => setTimeout(r, 60));
}

/** Endpoint -> number of step-up calls made against it. */
function callsByPath() {
  const counts: Record<string, number> = {};
  for (const [path] of apiFetchStepUp.mock.calls as [string][]) {
    counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
}

const ONCE_EACH = {
  '/api/my-shares': 1,
  '/api/my-listings': 1,
  '/api/my-selling': 1,
};

describe('dashboard fetches each endpoint once per mount', () => {
  it('does not refetch when the pubkey lands', async () => {
    // The production path, not the dev double-mount.
    renderDashboard(false);
    await settle();
    expect(callsByPath()).toEqual(ONCE_EACH);
  });

  it('does not double-fetch under StrictMode', async () => {
    // StrictMode mounts, unmounts and remounts every effect in dev. Only in-flight query
    // dedup collapses that back to one request per endpoint.
    renderDashboard(true);
    await settle();
    expect(callsByPath()).toEqual(ONCE_EACH);
  });
});
