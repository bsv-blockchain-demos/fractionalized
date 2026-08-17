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

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    rerender(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>,
    );

    // Count BEFORE asserting the redirect. The effects await ensureWallet(), so a re-fire needs
    // a real settle window to reach apiFetchStepUp — and if the redirect assertion ran first it
    // would throw on a broken guard, making this test prove "it redirects" instead of "no calls".
    await new Promise((r) => setTimeout(r, 50));
    expect(apiFetchStepUp.mock.calls.length).toBe(callsWhileAuthenticated);

    await waitFor(() => expect(screen.getByText('login page')).toBeInTheDocument());
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
