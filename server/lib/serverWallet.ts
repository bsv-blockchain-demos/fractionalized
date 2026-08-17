import type { WalletInterface } from '@bsv/sdk';
import { makeWallet } from './makeWallet';
import { getServerPrivateKey, getWalletStorageUrl } from '../config';

let walletPromise: Promise<WalletInterface> | null = null;

/**
 * The one server wallet for this process. Memoizes the in-flight PROMISE (not
 * the resolved wallet) so concurrent first-callers share a single
 * StorageClient handshake instead of building two wallets over the same key.
 * A rejection clears the memo so a transient storage outage is retryable.
 */
export function getServerWallet(): Promise<WalletInterface> {
  if (!walletPromise) {
    walletPromise = makeWallet('main', getWalletStorageUrl(), getServerPrivateKey());
    walletPromise.catch(() => { walletPromise = null; });
  }
  return walletPromise;
}

/** Test-only: drop the memo so a fresh wallet is built on the next call. */
export function resetServerWalletForTests(): void {
  walletPromise = null;
}
