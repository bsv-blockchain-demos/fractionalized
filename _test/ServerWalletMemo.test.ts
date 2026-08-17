import type { WalletInterface } from '@bsv/sdk';

jest.mock('@server/lib/makeWallet', () => ({ makeWallet: jest.fn() }));
import { makeWallet } from '@server/lib/makeWallet';
import { getServerWallet, resetServerWalletForTests } from '@server/lib/serverWallet';
import { getWalletQueue, resetWalletQueueForTests } from '@server/lib/walletQueue';

// NOTE: the brief's original test used `jest.resetModules()` + a per-test
// `await import(...)` to isolate module-level singleton state between tests.
// That pattern does not hold up against Jest's real resetModules() semantics:
// resetModules() clears `_mockRegistry`, so the NEXT require of a
// jest.mock(factory)-mocked path re-invokes the factory and produces a BRAND
// NEW `jest.fn()` — disconnected from the `mockedMakeWallet` reference bound
// by this file's static top-level import. Confirmed empirically (a scratch
// repro logged `SAME REF: false` and the SUT's `makeWallet` call returned
// `undefined`, i.e. an unconfigured mock, causing every test to fail with
// "Cannot read properties of undefined (reading 'catch')" regardless of the
// production implementation). Using the module's own exported
// `resetServerWalletForTests()` / `resetWalletQueueForTests()` — which exist
// precisely to clear the memo between tests — avoids the module-registry
// churn entirely: one static import, one stable mock identity, per-test state
// reset via the production reset hooks instead of `jest.resetModules()`.
const mockedMakeWallet = makeWallet as jest.MockedFunction<typeof makeWallet>;

describe('getServerWallet', () => {
  beforeEach(() => {
    resetServerWalletForTests();
    resetWalletQueueForTests();
    mockedMakeWallet.mockReset();
    process.env.SERVER_PRIVATE_KEY = 'aa'.repeat(32);
    process.env.WALLET_STORAGE_URL = 'https://storage.example.com';
  });

  test('builds the wallet once for concurrent first-callers', async () => {
    const wallet = {} as WalletInterface;
    mockedMakeWallet.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return wallet;
    });

    const [a, b] = await Promise.all([getServerWallet(), getServerWallet()]);

    expect(a).toBe(wallet);
    expect(b).toBe(wallet);
    expect(mockedMakeWallet).toHaveBeenCalledTimes(1);
  });

  test('reuses the wallet on a later call', async () => {
    mockedMakeWallet.mockResolvedValue({} as WalletInterface);
    await getServerWallet();
    await getServerWallet();
    expect(mockedMakeWallet).toHaveBeenCalledTimes(1);
  });

  test('does not cache a failed handshake — a later call retries', async () => {
    mockedMakeWallet.mockRejectedValueOnce(new Error('storage down'));

    await expect(getServerWallet()).rejects.toThrow('storage down');

    const wallet = {} as WalletInterface;
    mockedMakeWallet.mockResolvedValueOnce(wallet);
    await expect(getServerWallet()).resolves.toBe(wallet);
    expect(mockedMakeWallet).toHaveBeenCalledTimes(2);
  });
});

describe('getWalletQueue', () => {
  beforeEach(() => {
    resetServerWalletForTests();
    resetWalletQueueForTests();
    mockedMakeWallet.mockReset();
    process.env.SERVER_PRIVATE_KEY = 'aa'.repeat(32);
    process.env.WALLET_STORAGE_URL = 'https://storage.example.com';
  });

  test('returns one queue for concurrent first-callers', async () => {
    mockedMakeWallet.mockResolvedValue({} as WalletInterface);
    const [a, b] = await Promise.all([getWalletQueue(), getWalletQueue()]);
    expect(a).toBe(b);
  });

  test('does not cache a failed wallet init', async () => {
    mockedMakeWallet.mockRejectedValueOnce(new Error('storage down'));

    await expect(getWalletQueue()).rejects.toThrow('storage down');

    mockedMakeWallet.mockResolvedValueOnce({} as WalletInterface);
    await expect(getWalletQueue()).resolves.toBeDefined();
  });
});
