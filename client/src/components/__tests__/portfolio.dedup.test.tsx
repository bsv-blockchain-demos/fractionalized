/**
 * A step-up read costs a wallet signature and a server-side nonce, so it must happen
 * exactly once: once across components that want the same data, and once even when it
 * fails — a retry would mint a NEW proof and burn another nonce.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

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
import { MarketSellModal } from '../market-sell-modal';

const SHARE = { _id: 's1', propertyId: 'p1', amount: 10, transferTxid: 'tx.0' };
const PROPERTY = {
  _id: 'p1', title: 'P', location: 'L', priceUSD: 100, status: 'open',
  grossYield: '5%', netYield: '4%', annualisedReturn: '6%', images: [],
  txids: { tokenTxid: 't' },
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  queryClient.clear();
  apiFetchStepUp.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('my-shares') ? { shares: [SHARE] } : {}),
  }));
  apiFetch.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/api/check-session')
        ? { authenticated: true }
        : { item: PROPERTY },
  }));
});

function countCalls(mock: typeof apiFetch, needle: string) {
  return (mock.mock.calls as [string][]).filter(([u]) => String(u).includes(needle)).length;
}

describe('the dashboard and the sell modal share one read', () => {
  it('requests /api/my-shares once when both are mounted', async () => {
    render(
      <MemoryRouter>
        <AuthContextProvider>
          <QueryClientProvider client={queryClient}>
            <Dashboard />
            <MarketSellModal open loading={false} success={false} onClose={() => {}} onListed={() => {}} />
          </QueryClientProvider>
        </AuthContextProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(countCalls(apiFetchStepUp, 'my-shares')).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

    expect(countCalls(apiFetchStepUp, '/api/my-shares')).toBe(1);
    // Both components want the same property detail; so does the detail page.
    expect(countCalls(apiFetch, '/api/properties/p1')).toBe(1);
  });
});

describe('a failed step-up read is not retried', () => {
  it('mints one proof for a 500, not one per attempt', async () => {
    apiFetchStepUp.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(
      <MemoryRouter>
        <AuthContextProvider>
          <QueryClientProvider client={queryClient}>
            <Dashboard />
          </QueryClientProvider>
        </AuthContextProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(countCalls(apiFetchStepUp, 'my-shares')).toBeGreaterThan(0));
    // Long enough to clear the library's first retry backoff (~1s) if one were configured.
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });

    expect(countCalls(apiFetchStepUp, '/api/my-shares')).toBe(1);
  });
});
