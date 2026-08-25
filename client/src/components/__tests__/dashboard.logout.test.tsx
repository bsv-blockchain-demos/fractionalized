/**
 * M-11 regression: logging out must not fire authenticated requests.
 *
 * The dashboard's three effects key on [userWallet, userPubKey, ensureWallet], and none of
 * them guards on userPubKey — each awaits ensureWallet(), which still resolves after logout
 * because the BSV wallet stays connected. Only the server session is gone, so a re-fire lands
 * a 401 per effect. Task 4 fixed this incidentally: logout() batches status='idle' with the
 * null pubkey, so ProtectedRoute unmounts the subtree in the same commit and the effects never
 * re-run. Nothing asserts that, hence this test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ProtectedRoute } from '../routing/ProtectedRoute';
import { Dashboard } from '../dashboard';

const useAuthContext = vi.fn();
vi.mock('@/context/walletContext', () => ({ useAuthContext: () => useAuthContext() }));

const apiFetchStepUp = vi.fn();
vi.mock('@/lib/apiFetchStepUp', () => ({
  apiFetchStepUp: (...args: unknown[]) => apiFetchStepUp(...args),
}));

const apiFetch = vi.fn();
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

vi.mock('@/hooks/useCancelListing', () => ({
  useCancelListing: () => ({ cancelListing: vi.fn(), cancellingId: null }),
}));

// Not the subject; stubbed so the assertion counts only the dashboard's own calls.
vi.mock('@/components/dashboard/SellingListings', () => ({ default: () => null }));
vi.mock('@/components/dashboard/MarketListings', () => ({ default: () => null }));
vi.mock('@/components/dashboard/PortfolioStats', () => ({ default: () => null }));

const userWallet = { id: 'stable-wallet' };
const ensureWallet = vi.fn(async () => '02deadbeef');

function ctx(status: string, userPubKey: string | null) {
  return { status, userPubKey, userWallet, ensureWallet };
}

// A fresh element per call: React bails out of re-rendering an identical element reference,
// which would stop ProtectedRoute ever re-evaluating on rerender.
const tree = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);

function renderDashboard() {
  return render(tree());
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // A cached entry would let the second case pass without ever fetching.
  queryClient.clear();
  apiFetchStepUp.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});

describe('logout does not fire authenticated requests (M-11)', () => {
  it('makes no further step-up calls once status flips to idle', async () => {
    useAuthContext.mockReturnValue(ctx('authenticated', '02deadbeef'));
    const { rerender } = renderDashboard();

    // Baseline: the mounted dashboard legitimately fetches. Without this the test could pass
    // vacuously by never having mounted anything.
    await waitFor(() => expect(apiFetchStepUp.mock.calls.length).toBeGreaterThan(0));
    const callsWhileAuthenticated = apiFetchStepUp.mock.calls.length;

    useAuthContext.mockReturnValue(ctx('idle', null));
    // Real logout() clears the cache. Without this the count assertion below is vacuous:
    // a warm cache means no refetch on re-render whether or not the subtree unmounted.
    // Cleared, a still-mounted dashboard refetches immediately — which is the regression.
    queryClient.clear();
    rerender(tree());

    // Count BEFORE asserting the redirect. The effects await ensureWallet(), so a re-fire needs
    // a real settle window to reach apiFetchStepUp — and if the redirect assertion ran first it
    // would throw on a broken guard, making this test prove "it redirects" instead of "no calls".
    await new Promise((r) => setTimeout(r, 50));
    expect(apiFetchStepUp.mock.calls.length).toBe(callsWhileAuthenticated);

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
  });

  // The count assertion above can no longer fail on its own: the step-up queries carry
  // `enabled: status === 'authenticated' && !!userPubKey`, so a disabled query stays put even
  // against a cleared cache. That gate is now the real defence, so assert it directly —
  // mounted, unguarded, unauthenticated, and it must still not fetch.
  it('fires nothing when unauthenticated, even mounted outside the guard', async () => {
    useAuthContext.mockReturnValue(ctx('idle', null));
    queryClient.clear();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </QueryClientProvider>,
    );

    await new Promise((r) => setTimeout(r, 60));
    expect(apiFetchStepUp).not.toHaveBeenCalled();
  });

  it('unmounts the protected subtree rather than leaving it mounted', async () => {
    useAuthContext.mockReturnValue(ctx('authenticated', '02deadbeef'));
    renderDashboard();
    await waitFor(() => expect(apiFetchStepUp.mock.calls.length).toBeGreaterThan(0));

    cleanup();
    useAuthContext.mockReturnValue(ctx('idle', null));
    renderDashboard();

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
    expect(screen.queryByText(/portfolio/i)).not.toBeInTheDocument();
  });
});
