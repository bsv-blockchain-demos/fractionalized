import { connectToMongo } from '../src/lib/mongo';
import { getWalletQueue } from './lib/walletQueue';

/**
 * Fail-fast startup init for the single-instance backend.
 * - connectToMongo(): opens the pooled connection AND asserts the required
 *   unique indexes (throws if `npm run db:migrate` was never run).
 * - getWalletQueue(): builds the single wallet + queue now, so the first mint
 *   doesn't pay init cost and there is exactly one queue.
 * Any failure rejects → index.ts exits non-zero rather than serving
 * half-initialized.
 */
export async function boot(): Promise<void> {
  await connectToMongo();
  await getWalletQueue();
}
