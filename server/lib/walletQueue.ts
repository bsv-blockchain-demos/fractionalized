import type { WalletInterface } from '@bsv/sdk';
import { logger } from '@shared/logger';
import { getServerWallet } from './serverWallet';

export type WalletAction<T> = (wallet: WalletInterface) => Promise<T>;

/**
 * Serializes all server-wallet UTXO actions: at most one runs at a time (FIFO).
 * A rejected action rejects only its own caller and never blocks later actions.
 *
 * Single-instance deployment closes the cross-process UTXO race; this closes
 * the in-process one. Both are required.
 *
 * NEVER call enqueue() from inside an enqueued action — the inner call chains off a
 * tail that cannot settle until the outer action finishes, deadlocking the queue
 * permanently and silently (depth() pins, no error, no timeout).
 */
export class WalletQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly wallet: WalletInterface) {}

  enqueue<T>(label: string, fn: WalletAction<T>): Promise<T> {
    this.pending++;
    // Start fn only after the previous action settles (tail is always fulfilled).
    const result = this.tail.then(() => fn(this.wallet));
    // Advance the tail on BOTH paths → error isolation. Without this, one
    // rejected action rejects every action queued behind it.
    this.tail = result.then(
      () => undefined,
      (err) => { logger.error(`[walletQueue] action "${label}" failed:`, err); },
    );
    const settle = () => { this.pending--; };
    result.then(settle, settle);
    return result;
  }

  depth(): number {
    return this.pending;
  }
}

let singletonPromise: Promise<WalletQueue> | null = null;

/**
 * The process-wide wallet queue over the single server wallet. Memoizes the
 * in-flight PROMISE so concurrent first-calls all receive the SAME queue —
 * two queues over one wallet would not serialize anything.
 */
export function getWalletQueue(): Promise<WalletQueue> {
  if (!singletonPromise) {
    singletonPromise = getServerWallet().then((w) => new WalletQueue(w));
    singletonPromise.catch(() => { singletonPromise = null; });
  }
  return singletonPromise;
}

/** Test-only: drop the memo. */
export function resetWalletQueueForTests(): void {
  singletonPromise = null;
}
