/**
 * logout() must empty the query cache. Without it the previous identity's private reads stay
 * resident in memory and a wallet switch in the same tab can serve them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

vi.mock('@bsv/sdk', () => ({
  WalletClient: class {
    getPublicKey = async () => ({ publicKey: '02deadbeef' });
    isAuthenticated = async () => ({ authenticated: true });
  },
}));
const apiFetch = vi.fn();
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { AuthContextProvider, useAuthContext } from '@/context/walletContext';
import { queryClient } from '@/lib/queryClient';
import { qk } from '@/lib/queryKeys';

let logout: () => void;
function Probe() {
  logout = useAuthContext().logout;
  return null;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  queryClient.clear();
  apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ authenticated: true }) });
});

describe('logout clears the query cache', () => {
  it('leaves nothing resident, private or public', async () => {
    queryClient.setQueryData(qk.myShares('02deadbeef'), ['share']);
    queryClient.setQueryData(qk.myListings('02deadbeef'), ['listing']);
    queryClient.setQueryData(qk.listings(), ['public']);

    // Inside act so the provider's check-session settles before the assertions.
    await act(async () => { render(<AuthContextProvider><Probe /></AuthContextProvider>); });
    // Guard against a vacuous pass: the cache has to be non-empty going in.
    expect(queryClient.getQueryCache().getAll().length).toBe(3);

    act(() => logout());

    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});
